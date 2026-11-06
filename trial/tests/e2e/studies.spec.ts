import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { startTrial } from "./helpers";

/**
 * The clench study (research/NEXT.md, experiment 1) in the browser, on the
 * simulated earbuds with the simulated participant: set up, every cue,
 * the free period, the result against the bars, and the report file.
 */
test("studies: a quick clench study on the simulated earbuds, scored and saved", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startTrial(page);
  await page.goto("/studies");
  await expect(page.getByRole("heading", { name: "Studies", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /Clench in real life/ }).click();
  await expect(page.getByRole("heading", { name: "Clench in real life", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Use the simulated earbuds" }).click();
  const start = page.getByRole("button", { name: "Start the study" });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("radio", { name: "Quick try, about 2 min" }).click();
  await page.getByLabel("Participant code").fill("E2E");
  await start.click();

  await expect(page.getByText(/Cue \d of 6/)).toBeVisible();
  await expect(page.getByText(/Clench once|Clench twice|Clench and hold/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Free period")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Result" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("A simulated participant on simulated earbuds", { exact: false })).toBeVisible();
  await expect(page.getByText("False per hour")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save report (JSON)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^signalive-clench-E2E-.*\.json$/);
  const report = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(report).toMatchObject({ study: "clench", participant: "E2E", transport: "simulated", simulatedParticipant: true });
  expect(report.prompts).toHaveLength(6);
  expect(errors).toEqual([]);
});
