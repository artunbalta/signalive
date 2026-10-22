import { expect, test } from "@playwright/test";
import { fakeMic, holdRing, startTrial } from "./helpers";

test.use({ launchOptions: fakeMic("en-what-can-you-do") });

const PREFS = "signalive.trial.v1";
const RESET_NOTE = "no longer has your agreement";

/**
 * Without a database the server keeps agreements in memory and forgets them
 * when it restarts, while the browser still holds its copy. The app must send
 * the visitor back to the consent screen, both when a page loads and in the
 * middle of use, instead of failing every call after that.
 */
test("a server that lost the agreement sends the visitor back to consent", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startTrial(page);

  // On load. A new identity stands in for a restarted server: it has never seen it.
  await page.evaluate((key) => {
    const prefs = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...prefs, devUserId: crypto.randomUUID() }));
  }, PREFS);
  await page.goto("/notes");
  await page.waitForURL("**/consent?reset=1");
  await expect(page.getByText(RESET_NOTE)).toBeVisible();
  await page.getByText("I have read this and want to start the trial.").click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForURL("**/setup");

  // In the middle of use: the agreement disappears after the page loaded.
  await page.goto("/assistant");
  await expect(page.getByRole("button", { name: "Hold to talk" })).toBeVisible();
  await page.evaluate(async (key) => {
    const prefs = JSON.parse(localStorage.getItem(key) ?? "{}") as { devUserId: string; consentVersion: string };
    const res = await fetch("/api/consent", {
      method: "POST",
      headers: { Authorization: `Bearer dev.${prefs.devUserId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "terms", version: prefs.consentVersion, granted: false }),
    });
    if (!res.ok) throw new Error(`withdraw failed: ${res.status}`);
  }, PREFS);
  // Hold through a whole loop of the fixture, so the speech is in it.
  await holdRing(page, 6800);
  await page.waitForURL("**/consent?reset=1");
  await expect(page.getByText(RESET_NOTE)).toBeVisible();

  // Only the agreement went; the identity and device settings stay.
  const prefs = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>, PREFS);
  expect(prefs.consentVersion).toBeUndefined();
  expect(prefs.devUserId).toEqual(expect.any(String));
  expect(errors).toEqual([]);
});
