import { expect, test } from "@playwright/test";
import { startTrial } from "./helpers";

/**
 * The simulated earbuds end to end, in the browser: connected from Settings,
 * a clench goes through the clench detector (lib/sense), the gesture bus and
 * the command router to the bound command, Rewind and recap by default, and
 * a head turn reaches the earbuds' motion readout. No microphone, camera or
 * provider is involved.
 */
test("earbuds: connect the simulated earbuds in Settings, and a clench runs the bound command", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startTrial(page);
  await page.goto("/settings");

  const card = page.locator("section", { has: page.getByRole("heading", { name: "Earbuds", exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Simulated earbuds" }).click();
  await expect(card.getByText("Battery 88%")).toBeVisible();
  await expect(card.getByText("Battery 91%")).toBeVisible();
  // The detector learns the background in its first second, then listens.
  await expect(card.getByText("Listening", { exact: true })).toBeVisible({ timeout: 10_000 });

  await card.getByRole("button", { name: "Clench", exact: true }).click();
  await expect(card.getByText("Jaw clench: Rewind and recap")).toBeVisible({ timeout: 5000 });
  // Rewind ran, and says it has nothing kept while it is off.
  await expect(card.getByText("Turn on Rewind first: it can only replay what it has kept.")).toBeVisible();

  await card.getByRole("button", { name: "Double clench" }).click();
  await expect(card.getByText("Double jaw clench: Mark this moment")).toBeVisible({ timeout: 5000 });

  await card.getByRole("button", { name: "Turn the head" }).click();
  await expect(card.getByText("30° right")).toBeVisible({ timeout: 5000 });

  await card.getByRole("button", { name: "Disconnect" }).click();
  await expect(card.getByRole("button", { name: "Simulated earbuds" })).toBeVisible();
  await expect(card.getByText("Battery 88%")).toHaveCount(0);
  expect(errors).toEqual([]);
});
