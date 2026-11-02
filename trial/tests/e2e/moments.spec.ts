import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { decodeWav, rmsDbfs } from "../../lib/shared/audio/wav";
import { fakeMic, startTrial } from "./helpers";
import { mockAgent, mockMoments, recordUploads, toneBase64, uploads } from "./moments-helpers";

/**
 * Moments end to end, on recorded streams: POST /api/moments and POST
 * /api/agent are answered from tests/fixtures/moments through page.route,
 * so neither keys nor the server routes are needed. The microphone is
 * Chromium's fake one playing a recorded monologue, and the moments are kept
 * in the browser's real IndexedDB.
 */
test.use({ launchOptions: fakeMic("en-recorder-monologue"), serviceWorkers: "block" });

const BANNER = "Listening: the last 30 seconds stay in this device's memory only.";
const LAUNCH = "Launch deck and the venue call";
const STANDUP = "Budget review moves to Thursday";

async function startListening(page: Page) {
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect(page.getByText(BANNER)).toBeVisible();
  // A few seconds kept, with speech in them.
  await page.waitForTimeout(3500);
}

test("moments: keep one with the button, read it, ask about it, accept the reminder", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(recordUploads);
  await mockMoments(page, ["moment-launch", "moment-standup"]);
  const asked = await mockAgent(page, ["agent-reminder"]);
  await startTrial(page);
  await page.goto("/moments");

  // Nothing is kept yet, and the screen says how a moment is made.
  await expect(page.getByRole("heading", { name: "Clench, and the moment is kept." })).toBeVisible();
  await expect(page.getByText(BANNER)).toHaveCount(0);

  await startListening(page);
  await page.getByRole("button", { name: /Keep this moment/ }).click();
  await expect(page.getByText("Listening back")).toBeVisible();
  const card = page.locator("article", { has: page.getByRole("link", { name: LAUNCH }) });
  await expect(card).toBeVisible();
  await expect(card.getByText("Ayşe sends the launch deck")).toBeVisible();

  // What left the browser: the seconds kept, once, as 16 kHz audio with speech, and the meta the contract asks for.
  const sent = await uploads(page, "/api/moments");
  expect(sent).toHaveLength(1);
  expect(sent[0]!.meta).toMatchObject({ trigger: "button", speak: true, place: null, replyLang: "en", speechLang: "en" });
  expect(String(sent[0]!.meta.now)).toMatch(/\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}\)$/);
  const wav = decodeWav(new Uint8Array(sent[0]!.audio));
  expect(wav.sampleRate).toBe(16000);
  expect(wav.durationMs).toBeGreaterThan(2500);
  expect(wav.durationMs).toBeLessThan(8000);
  expect(rmsDbfs(wav.samples)).toBeGreaterThan(-55);

  // Kept on the device: a reload brings it back.
  await page.reload();
  await expect(card).toBeVisible();

  // The moment itself.
  await card.getByRole("link", { name: LAUNCH }).click();
  await page.waitForURL("**/moments/*");
  await expect(page.getByRole("heading", { name: LAUNCH, level: 1 })).toBeVisible();
  await expect(page.getByText("The venue still has to confirm the projector")).toBeVisible();
  await expect(page.getByText(/Ayşe, can you send me the launch deck by Friday at three\?/)).toBeVisible();
  await expect(page.getByText("Kept with the button")).toBeVisible();

  // Remind me: a calendar file, with an alert at the due time.
  const [reminderFile] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Remind me" }).first().click(),
  ]);
  expect(reminderFile.suggestedFilename()).toBe("signalive-ayşe-sends-the-launch-deck.ics");
  const ics = readFileSync((await reminderFile.path())!, "utf8");
  expect(ics).toContain("BEGIN:VEVENT");
  expect(ics).toContain("SUMMARY:Ayşe sends the launch deck");
  expect(ics).toContain("TRIGGER:PT0M");
  expect(ics.includes("\r\n")).toBe(true);
  await expect(page.getByText("Calendar file downloaded. Open it to add it to your calendar.")).toBeVisible();

  // Ask about it.
  await page.getByRole("link", { name: "Ask", exact: true }).click();
  await page.waitForURL("**/ask");
  await page.getByPlaceholder("Ask about your moments").fill("What did Ayşe promise me?");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Ayşe will send you the launch deck by Friday at 15:00/)).toBeVisible();
  expect(asked).toHaveLength(1);
  const body = asked[0] as { messages: { role: string; text: string }[]; moments: { id: string; title: string; transcript: string }[]; replyLang: string; speak: boolean };
  expect(body.messages.at(-1)).toEqual({ role: "user", text: "What did Ayşe promise me?" });
  expect(body.moments).toHaveLength(1);
  expect(body.moments[0]).toMatchObject({ title: LAUNCH });
  expect(body.moments[0]!.transcript).toContain("launch deck");
  expect(body).toMatchObject({ replyLang: "en", speak: false });

  // The moment it drew on, linked; the reminder it proposes, waiting for Accept.
  const cited = page.getByRole("link", { name: new RegExp(LAUNCH) });
  await expect(cited).toBeVisible();
  const proposal = page.getByRole("group", { name: /Reminder: Call the venue about the projector/ });
  await expect(proposal).toBeVisible();
  const [acceptedFile] = await Promise.all([page.waitForEvent("download"), proposal.getByRole("button", { name: "Accept" }).click()]);
  expect(readFileSync((await acceptedFile.path())!, "utf8")).toContain("SUMMARY:Call the venue about the projector");
  await expect(proposal.getByText("Reminder added")).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Accept" })).toHaveCount(0);

  // The cited moment opens, and keeps what was accepted.
  await cited.click();
  await page.waitForURL("**/moments/*");
  await expect(page.getByText("Suggested by Ask")).toBeVisible();
  await expect(page.getByRole("group", { name: /Reminder: Call the venue/ }).getByText("Reminder added")).toBeVisible();

  // J stands in for a clench: another moment, kept with a key.
  await page.getByRole("link", { name: "Moments", exact: true }).first().click();
  await page.waitForURL("**/moments");
  await startListening(page);
  await page.keyboard.press("j");
  await expect(page.getByRole("link", { name: STANDUP })).toBeVisible();
  expect((await uploads(page, "/api/moments")).at(-1)!.meta).toMatchObject({ trigger: "key" });
  await expect(page.getByText("2 moments on this device")).toBeVisible();

  // Search, and filter by a person.
  await page.getByPlaceholder("Search moments").fill("budget");
  await expect(page.getByRole("link", { name: STANDUP })).toBeVisible();
  await expect(page.getByRole("link", { name: LAUNCH })).toHaveCount(0);
  await page.getByPlaceholder("Search moments").fill("");
  await page.getByRole("button", { name: /Ayşe/ }).click();
  await expect(page.getByRole("link", { name: LAUNCH })).toBeVisible();
  await expect(page.getByRole("link", { name: STANDUP })).toHaveCount(0);
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(page.getByRole("link", { name: STANDUP })).toBeVisible();

  // Delete one.
  await page.getByRole("link", { name: LAUNCH }).click();
  await page.waitForURL("**/moments/*");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await page.waitForURL("**/moments");
  await expect(page.getByRole("link", { name: STANDUP })).toBeVisible();
  await expect(page.getByRole("link", { name: LAUNCH })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("moments: streams recorded from the real routes replay through the app", async ({ page }) => {
  // recorded-*.ndjson: what POST /api/moments and POST /api/agent sent on 2026-11-02 (OpenAI recognition and
  // speech, claude-sonnet-5-5), with the audio cut to one short placeholder per sentence.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockMoments(page, ["recorded-moment"]);
  const asked = await mockAgent(page, ["recorded-agent"]);
  await startTrial(page);
  await page.goto("/moments");
  await startListening(page);
  await page.getByRole("button", { name: /Keep this moment/ }).click();
  const card = page.locator("article", { has: page.getByRole("link", { name: "Launch prep recap" }) });
  await expect(card).toBeVisible();
  await expect(card.getByText("Aisha will send the launch deck.")).toBeVisible();
  await expect(card.getByText("+1")).toBeVisible();

  await card.getByRole("link", { name: "Launch prep recap" }).click();
  await expect(page.getByText("Mert booking meeting room for Thursday afternoon")).toBeVisible();
  await expect(page.getByRole("link", { name: "Aisha" })).toBeVisible();

  await page.getByRole("link", { name: "Ask about this" }).click();
  await page.waitForURL("**/ask");
  await expect(page.getByText("About: Launch prep recap")).toBeVisible();
  await page.getByPlaceholder("Ask about your moments").fill("When is the launch deck due, and remind me to check it then.");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/I've proposed a reminder for you to check it then/)).toBeVisible();
  // The question went with the moment it was asked from, first.
  expect((asked[0] as { moments: { title: string }[] }).moments[0]).toMatchObject({ title: "Launch prep recap" });
  await expect(page.getByRole("link", { name: /Launch prep recap/ })).toBeVisible();
  const proposal = page.getByRole("group", { name: /Reminder: Check the launch deck from Aisha/ });
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Dismiss" }).click();
  await expect(proposal.getByText("Dismissed")).toBeVisible();
  await expect(page.getByText("1 moment went with this question")).toBeVisible();
  expect(errors).toEqual([]);
});

test("moments: read a moment aloud, draft a follow up from what to do, and add the proposed event", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockMoments(page, ["moment-launch"]);
  const asked = await mockAgent(page, ["agent-draft"]);
  const spoken: Record<string, unknown>[] = [];
  await page.route("**/api/speak", async (route) => {
    spoken.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
      body: `${JSON.stringify({ t: "sentence", i: 0, text: LAUNCH })}\n${JSON.stringify({ t: "audio", i: 0, sr: 24000, pcm: toneBase64(1.2) })}\n${JSON.stringify({ t: "done", totalMs: 900 })}\n`,
    });
  });
  await startTrial(page);
  await page.goto("/moments");
  await startListening(page);
  await page.getByRole("button", { name: /Keep this moment/ }).click();
  await page.getByRole("link", { name: LAUNCH }).click();
  await page.waitForURL("**/moments/*");

  // Listen: the moment read aloud, then the button is Listen again.
  await page.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Listen" })).toBeVisible({ timeout: 10_000 });
  expect(spoken[0]).toMatchObject({ lang: "en" });
  expect(String(spoken[0]!.text)).toContain(LAUNCH);
  expect(String(spoken[0]!.text)).toContain("Call the venue about the projector");

  // Draft: Ask writes a follow up about that item, with this moment first.
  await page.locator("li", { hasText: "Ayşe sends the launch deck" }).getByRole("link", { name: "Draft" }).click();
  await page.waitForURL("**/ask");
  await expect(page.getByText("Draft a short message to follow up on this: Ayşe sends the launch deck")).toBeVisible();
  await expect(page.getByText("Here is a short note you could send Ayşe.")).toBeVisible();
  expect((asked[0] as { moments: { title: string }[] }).moments[0]).toMatchObject({ title: LAUNCH });

  const draft = page.getByRole("group", { name: /Message draft/ });
  await expect(draft.getByText("Hi Ayşe, thanks for taking the launch deck. Friday at 15:00 works for me.")).toBeVisible();
  await draft.getByRole("button", { name: "Copy" }).click();
  await expect(draft.getByText("Draft copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Hi Ayşe, thanks for taking the launch deck. Friday at 15:00 works for me.");

  // The proposed event goes to the calendar as a file, an hour long, with an alert.
  const event = page.getByRole("group", { name: /Event: Launch deck review/ });
  await expect(event.getByText(/Moda/)).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent("download"), event.getByRole("button", { name: "Accept" }).click()]);
  const ics = readFileSync((await file.path())!, "utf8");
  expect(ics).toContain("SUMMARY:Launch deck review");
  expect(ics).toContain("DTSTART:20261106T120000Z");
  expect(ics).toContain("DTEND:20261106T130000Z");
  expect(ics).toContain("LOCATION:Moda");
  expect(ics).toContain("TRIGGER:-PT15M");
  await expect(event.getByText("Added to calendar")).toBeVisible();
  expect(errors).toEqual([]);
});

test("moments: inside the Signalive app, reminders and events go straight to the phone's calendar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    const w = window as unknown as { __calendar: unknown[]; SignaliveNative: unknown };
    w.__calendar = [];
    w.SignaliveNative = {
      calendar: {
        addEvent: async (e: unknown) => void w.__calendar.push(["event", e]),
        addReminder: async (r: unknown) => void w.__calendar.push(["reminder", r]),
      },
    };
  });
  await mockMoments(page, ["moment-launch"]);
  await startTrial(page);
  await page.goto("/moments");
  await startListening(page);
  await page.getByRole("button", { name: /Keep this moment/ }).click();
  await page.getByRole("link", { name: LAUNCH }).click();
  await page.waitForURL("**/moments/*");

  const second = page.locator("li", { hasText: "Call the venue about the projector" });
  await second.getByRole("button", { name: "Remind me" }).click();
  await expect(second.getByText("Added to your calendar.")).toBeVisible();
  await second.getByRole("button", { name: "Add to calendar" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __calendar: unknown[] }).__calendar.length)).toBe(2);
  const calls = await page.evaluate(() => (window as unknown as { __calendar: [string, Record<string, unknown>][] }).__calendar);
  expect(calls[0]![0]).toBe("reminder");
  expect(calls[0]![1]).toMatchObject({ title: "Call the venue about the projector", notes: LAUNCH });
  expect(String(calls[0]![1].due)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(calls[1]![0]).toBe("event");
  expect(calls[1]![1]).toMatchObject({ title: "Call the venue about the projector", allDay: false, alarmMinutes: 15 });
  expect(errors).toEqual([]);
});

test("moments: where IndexedDB is refused, moments are kept in memory and the screen says so", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
  });
  await mockMoments(page, ["moment-standup"]);
  await startTrial(page);
  await page.goto("/moments");
  await expect(page.getByText("Moments are kept only while this page is open.")).toBeVisible();
  await startListening(page);
  await page.getByRole("button", { name: /Keep this moment/ }).click();
  await expect(page.getByRole("link", { name: STANDUP })).toBeVisible();
  // The banner keeps saying what is kept, and one tap stops it.
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText(BANNER)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start listening" })).toBeVisible();
  expect(errors).toEqual([]);
});
