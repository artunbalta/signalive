import { expect, test } from "@playwright/test";
import { decodeWav } from "../../lib/shared/audio/wav";
import { fakeMic, startTrial } from "./helpers";
import { mockAgent, mockRecognition, recordUploads, uploads } from "./moments-helpers";

/**
 * Asking by voice, on recorded streams. Where the browser cannot stream to
 * the recognizer (the case without Deepgram), a spoken question is
 * recognized through POST /api/stt, which stores nothing; the words then
 * go to POST /api/agent like a typed question, asking for a spoken answer. The fake microphone loops "What can you do?" every 6.4 s.
 */
test.use({ launchOptions: fakeMic("en-what-can-you-do"), serviceWorkers: "block" });

test("ask: hold the mic, speak, and the question is answered aloud", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(recordUploads);
  await mockRecognition(page);
  const asked = await mockAgent(page, ["agent-reminder"]);
  await startTrial(page);
  await page.goto("/ask");

  const mic = page.getByRole("button", { name: "Hold to ask" });
  await expect(mic).toBeVisible();
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // The microphone is live only while held, and says so on every screen.
  await expect(page.getByRole("status").filter({ hasText: "Listening for your question" })).toBeVisible();
  await page.waitForTimeout(6800);
  await page.mouse.up();

  await expect(page.getByText("What did Ayşe promise me?")).toBeVisible();
  await expect(page.getByText("Asked by voice")).toBeVisible();
  await expect(page.getByText(/Ayşe will send you the launch deck/)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Listening for your question" })).toHaveCount(0);
  // The microphone closed again once the question was asked: nothing else was listening.
  await expect(page.getByText("Mic off", { exact: true })).toBeVisible();

  const sent = await uploads(page, "/api/stt");
  expect(sent).toHaveLength(1);
  const wav = decodeWav(new Uint8Array(sent[0]!.audio));
  expect(wav.sampleRate).toBe(16000);
  expect(wav.durationMs).toBeGreaterThan(5000);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ speak: true, messages: [{ role: "user", text: "What did Ayşe promise me?" }] });
  expect(errors).toEqual([]);
});

test("ask: a held clench (H) listens until the talking stops, from any screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockRecognition(page);
  const asked = await mockAgent(page, ["agent-reminder"]);
  await startTrial(page);
  await page.goto("/moments");
  await expect(page.getByRole("heading", { name: "Clench, and the moment is kept." })).toBeVisible();

  // The first press opens the microphone, so it comes from a click, as a clench from the earbuds would after one.
  await page.getByRole("heading", { name: "Moments", level: 1 }).click();
  await page.keyboard.press("h");
  await expect(page.getByRole("status").filter({ hasText: "Listening for your question" })).toBeVisible();
  // It ends by itself, a moment after the question.
  await expect.poll(() => asked.length, { timeout: 20_000 }).toBe(1);
  expect(asked[0]).toMatchObject({ speak: true, messages: [{ role: "user", text: "What did Ayşe promise me?" }] });
  await expect(page.getByRole("status").filter({ hasText: "Listening for your question" })).toHaveCount(0);

  // The answer is in Ask.
  await page.getByRole("link", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Asked by voice")).toBeVisible();
  await expect(page.getByText(/Ayşe will send you the launch deck/)).toBeVisible();
  expect(errors).toEqual([]);
});
