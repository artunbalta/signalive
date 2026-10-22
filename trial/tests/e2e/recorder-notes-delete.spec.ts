import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fakeMic, startTrial } from "./helpers";

test.use({ launchOptions: fakeMic("en-recorder-monologue") });

test("record, mark, make notes, search, export, then delete everything", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await startTrial(page);
  await page.goto("/recorder");

  // Nothing records until the user presses start.
  await expect(page.getByText("Recording. Transcripts are being saved.")).toHaveCount(0);
  await page.getByRole("button", { name: "Start recording" }).click();
  const banner = page.getByRole("status").filter({ hasText: "Recording. Transcripts are being saved." });
  await expect(banner).toBeVisible({ timeout: 30_000 });

  // A VAD segment comes back as a transcript line.
  await expect(page.getByText("This is a mock transcript of what you said.").first()).toBeVisible({ timeout: 40_000 });

  await page.getByRole("button", { name: "Mark this moment" }).click();
  await expect(page.getByText("From a marked moment").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Make notes now" }).click();
  await expect(page.getByText("Made on request").first()).toBeVisible({ timeout: 30_000 });

  // The banner follows the user to other screens, with a one tap pause.
  await page.getByRole("link", { name: "Notes" }).click();
  await page.waitForURL("**/notes");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Recording paused. Nothing is being captured.")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).first().click();
  await expect(page.getByText("Recording paused. Nothing is being captured.")).toHaveCount(0);
  await expect(banner).toHaveCount(0);

  // Notes are listed and searchable by words and by meaning.
  await page.reload();
  await expect(page.locator("article").first()).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("Search your notes").fill("mock transcript");
  await page.getByRole("radio", { name: "Words" }).click();
  await expect(page.locator("article").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("radio", { name: "Meaning" }).click();
  await expect(page.locator("article").first()).toBeVisible({ timeout: 15_000 });

  // Export.
  await page.goto("/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export everything (JSON)" }).click(),
  ]);
  const bundle = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(bundle.notes.length).toBeGreaterThanOrEqual(2);
  expect(bundle.utterances.length).toBeGreaterThanOrEqual(1);
  expect(bundle.marks).toHaveLength(1);
  expect(bundle.consents.map((c: { kind: string }) => c.kind)).toContain("terms");

  // Delete everything.
  const devId = await page.evaluate(() => JSON.parse(localStorage.getItem("signalive.trial.v1") ?? "{}").devUserId as string);
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.getByRole("button", { name: "Yes, delete everything" }).click();
  await page.waitForURL("**/?deleted=1");
  await expect(page.getByText("Everything was deleted.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("signalive.trial.v1"))).toBeNull();

  // The old identity owns nothing any more.
  const res = await page.request.get("/api/export?format=json", { headers: { Authorization: `Bearer dev.${devId}` } });
  const after = await res.json();
  for (const key of ["sessions", "deviceProfiles", "consents", "utterances", "marks", "notes", "labRuns", "labResults", "latencyEvents", "audioObjects"]) {
    expect(after[key], key).toEqual([]);
  }
  expect(errors).toEqual([]);
});
