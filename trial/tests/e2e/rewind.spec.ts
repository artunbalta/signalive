import { expect, test } from "@playwright/test";
import { decodeWav, rmsDbfs } from "../../lib/shared/audio/wav";
import { fakeMic, startTrial } from "./helpers";

test.use({ launchOptions: fakeMic("en-what-can-you-do") });

/**
 * Keeps a copy of what the page sends to /api/rewind, before the request
 * leaves. (Playwright cannot read multipart bodies built from Blobs.)
 */
const captureRewind = () => {
  const w = window as unknown as { __rewind: { meta: string; audio: string }[] };
  w.__rewind = [];
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/rewind") && init?.body instanceof FormData) {
      const bytes = new Uint8Array(await (init.body.get("audio") as Blob).arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      w.__rewind.push({ meta: String(init.body.get("meta")), audio: btoa(bin) });
    }
    return orig(input, init);
  };
};

const BANNER = "Rewind is on: the last 30 seconds stay in this device's memory only.";

test("rewind: keep the last seconds, clench, hear them again, then what was said", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(captureRewind);
  await startTrial(page);
  await page.goto("/rewind");

  const clench = page.getByRole("button", { name: /Clench your jaw/ });
  await expect(clench).toBeDisabled();
  // The figure: WebGL, or the still drawing where WebGL is missing.
  await expect(page.locator("section canvas, section svg").first()).toBeVisible();

  await page.getByRole("switch", { name: /Keep the last 30 seconds/ }).click();
  await expect(page.getByText(BANNER)).toBeVisible();
  await expect(page.getByText("Listening. Clench to rewind.")).toBeVisible();
  await page.getByRole("radio", { name: "10 s" }).click();
  // More than ten seconds of the looping fixture, so the clip is full length.
  await page.waitForTimeout(11_000);

  // J stands in for the jaw clench, through the same gesture path a sensor will use.
  await page.keyboard.press("j");
  await expect(page.getByText("Rewinding 10 seconds")).toBeVisible();
  await expect(page.getByText("Playing it again")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("This is a mock transcript of what you said.", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/This is a mock recap\. Someone around you said:/)).toBeVisible({ timeout: 15_000 });
  // The ten seconds replay, the recap plays, and it listens again.
  await expect(page.getByText("What was said", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Listening. Clench to rewind.")).toBeVisible({ timeout: 40_000 });

  // What left the browser: the chosen seconds, once, at 16 kHz, with speech in them.
  const sent = await page.evaluate(() => (window as unknown as { __rewind: { meta: string; audio: string }[] }).__rewind);
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]!.meta)).toMatchObject({ replyLang: "en", seconds: 10 });
  const wav = decodeWav(new Uint8Array(Buffer.from(sent[0]!.audio, "base64")));
  expect(wav.sampleRate).toBe(16000);
  expect(wav.durationMs).toBeGreaterThan(9_500);
  expect(wav.durationMs).toBeLessThan(10_500);
  expect(rmsDbfs(wav.samples)).toBeGreaterThan(-45);

  // Off: the banner goes, and there is nothing left to rewind.
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText(BANNER)).toHaveCount(0);
  await expect(clench).toBeDisabled();
  expect(errors).toEqual([]);
});
