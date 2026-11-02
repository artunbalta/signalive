import { expect, test } from "@playwright/test";
import { startTrial } from "./helpers";

/**
 * One real moment and one real question, against the real routes and
 * providers: nothing is mocked. Skipped unless LIVE_WAV names a speech WAV
 * (48 kHz mono) for Chromium's fake microphone, made for example with a TTS
 * voice: about 1.5 s of silence, some speech with names, times and things to
 * do, then silence to 30 s. Run it against a server with keys:
 *
 *   LIVE_WAV=/path/speech.wav E2E_PORT=3001 npx playwright test tests/e2e/moments-live.spec.ts
 *
 * It prints the moment and the answer that came back.
 */
const wav = process.env.LIVE_WAV;
test.skip(!wav, "set LIVE_WAV to a speech WAV to run against the real routes");
test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
  serviceWorkers: "block",
});
test.setTimeout(240_000);

test("live: a real moment from real speech, then a real question about it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path === "/api/moments" || path === "/api/agent") timings[`${path} headers`] = Date.now() - t0;
  });

  await startTrial(page);
  await page.goto("/moments");
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect(page.getByText("Listening: the last 30 seconds stay in this device's memory only.")).toBeVisible();
  // The speech ends about 13.5 s into the file.
  await page.waitForTimeout(15_000);
  const keptAt = Date.now();
  await page.getByRole("button", { name: /Keep this moment/ }).click();
  await expect(page.getByText("Listening back")).toBeVisible();
  const link = page.locator("article h3 a").first();
  await expect(link).toBeVisible({ timeout: 90_000 });
  timings["moment on screen"] = Date.now() - keptAt;

  const moments = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open("signalive-moments");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction("moments", "readonly").objectStore("moments").getAll();
          all.onsuccess = () => resolve(all.result as unknown[]);
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(moments).toHaveLength(1);
  const moment = moments[0] as { id: string; title: string; summary: string; transcript: string; actionItems: unknown[]; people: string[] };
  console.log("\nLIVE MOMENT\n" + JSON.stringify(moment, null, 2));
  expect(moment.transcript.length).toBeGreaterThan(40);
  expect(moment.title.length).toBeGreaterThan(0);

  await link.click();
  await page.waitForURL("**/moments/*");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(moment.title);

  await page.getByRole("link", { name: "Ask", exact: true }).click();
  await page.getByPlaceholder("Ask about your moments").fill("When is the launch deck due, and remind me to check it then.");
  const askedAt = Date.now();
  await page.keyboard.press("Enter");
  const turn = page.locator("ol[role=log] > li").last();
  // Done, or failed: the context line shows once the answer is complete.
  await expect(turn.getByText(/went with this question/).or(turn.getByRole("alert"))).toBeVisible({ timeout: 90_000 });
  timings["answer complete"] = Date.now() - askedAt;
  const answer = await turn.innerText();
  console.log("\nLIVE ANSWER\n" + answer);
  console.log("\nTIMINGS (ms)\n" + JSON.stringify(timings, null, 2));
  expect(errors).toEqual([]);
});
