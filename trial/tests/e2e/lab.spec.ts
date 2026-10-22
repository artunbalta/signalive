import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { decodeWav, rmsDbfs } from "../../lib/shared/audio/wav";
import { fakeMic, startTrial } from "./helpers";

test.use({ launchOptions: fakeMic("en-what-can-you-do") });

/**
 * Captures what the page uploads for scoring: the chain WAVs from the
 * FormData, as base64, before the request leaves. (Playwright cannot read
 * multipart bodies built from Blobs.)
 */
const captureUploads = () => {
  const w = window as unknown as { __labUploads: Record<string, string>[] };
  w.__labUploads = [];
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/lab/transcribe") && init?.body instanceof FormData) {
      const entry: Record<string, string> = {};
      for (const [k, v] of init.body.entries()) {
        if (v instanceof Blob) {
          const bytes = new Uint8Array(await v.arrayBuffer());
          let bin = "";
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
          entry[k] = btoa(bin);
        }
      }
      w.__labUploads.push(entry);
    }
    return orig(input, init);
  };
};

test("lab: two takes through four chains, scored, then the dashboard and CSV", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(captureUploads);

  await startTrial(page);
  await page.goto("/lab");
  await page.getByRole("radio", { name: "English" }).click();
  await page.getByRole("radio", { name: "Whisper" }).click();
  await page.getByRole("combobox", { name: "Where you are" }).selectOption("street");
  await page.getByRole("button", { name: "Start the run" }).click();

  for (let take = 0; take < 2; take++) {
    await expect(page.getByText(/Phrase \d+ of 10/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Record", exact: true }).click();
    // One loop of the fixture holds the utterance; stop by hand to stay deterministic.
    await page.waitForTimeout(6600);
    const stop = page.getByRole("button", { name: /Recording, \d+ s/ });
    if (await stop.isVisible()) await stop.click();
    await expect(page.getByText("Scores for this take").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("table tbody tr")).toHaveCount(4);
    await page.getByRole("button", { name: "Next phrase" }).click();
  }

  // The audio sent for scoring: one 16 kHz file per chain, none silent.
  const uploads = await page.evaluate(() => (window as unknown as { __labUploads: Record<string, string>[] }).__labUploads);
  expect(uploads.length).toBe(2);
  const wavOf = (chain: string) => decodeWav(new Uint8Array(Buffer.from(uploads[0]![chain]!, "base64")));
  for (const chain of ["chain_raw", "chain_browser_default", "chain_raw_rnnoise", "chain_raw_hpf_gate"]) {
    expect(uploads[0]![chain], chain).toBeTruthy();
    const wav = wavOf(chain);
    expect(wav.sampleRate).toBe(16000);
    expect(rmsDbfs(wav.samples), chain).toBeGreaterThan(-50);
  }
  // RNNoise on clean speech should keep roughly the same level as raw.
  const raw = rmsDbfs(wavOf("chain_raw").samples);
  const rn = rmsDbfs(wavOf("chain_raw_rnnoise").samples);
  console.log(`raw ${raw.toFixed(1)} dBFS, rnnoise ${rn.toFixed(1)} dBFS, browser ${rmsDbfs(wavOf("chain_browser_default").samples).toFixed(1)}, gate ${rmsDbfs(wavOf("chain_raw_hpf_gate").samples).toFixed(1)}`);
  expect(Math.abs(raw - rn)).toBeLessThan(10);
  // ...and RNNoise really processed it: correlated with raw, but not a copy.
  const a = wavOf("chain_raw").samples;
  const b = wavOf("chain_raw_rnnoise").samples;
  let best = 0;
  for (let lag = 0; lag <= 600; lag += 1) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i + lag < b.length && i < a.length; i += 2) {
      xy += a[i]! * b[i + lag]!;
      xx += a[i]! * a[i]!;
      yy += b[i + lag]! * b[i + lag]!;
    }
    best = Math.max(best, xy / Math.sqrt(xx * yy || 1));
  }
  console.log(`raw to rnnoise correlation ${best.toFixed(4)}`);
  expect(best).toBeGreaterThan(0.5);
  expect(best).toBeLessThan(0.999);

  await page.getByRole("button", { name: "Stop the run" }).click();
  await page.getByRole("link", { name: "See results" }).click();
  await page.waitForURL("**/lab/results");
  await expect(page.getByText("Whisper in wind or noise, best chain")).toBeVisible();
  await expect(page.getByText(/\d+(\.\d)?%/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "By processing chain" })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  const csv = readFileSync((await download.path())!, "utf8");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines[0]!.replace(/^﻿/, "").split(",")[0]).toBe("created_at");
  expect(lines.length).toBe(1 + 2 * 4);
  expect(csv).toContain("whisper,street");
  expect(errors).toEqual([]);
});
