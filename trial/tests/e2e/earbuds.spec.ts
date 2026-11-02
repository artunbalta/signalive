import { expect, test } from "@playwright/test";
import { startTrial } from "./helpers";

/**
 * The simulated earbuds end to end, in the browser: connected from the
 * Earbuds screen, a clench goes through the clench detector (lib/sense), the
 * gesture bus and the command router to the bound command, and a head turn
 * reaches the earbuds' motion readout. By default a clench keeps a moment, a
 * double clench rewinds and a held clench asks by voice; with nothing kept
 * yet, the first two say so. No microphone, camera or provider is involved.
 */
test("earbuds: connect the simulated earbuds, and each clench runs its bound command", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await startTrial(page);
  await page.goto("/earbuds");
  await expect(page.getByRole("heading", { name: "Earbuds", level: 1 })).toBeVisible();

  const card = page.locator("section", { has: page.getByRole("heading", { name: "Signalive earbuds", exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Simulated earbuds" }).click();
  await expect(card.getByText("Battery 88%")).toBeVisible();
  await expect(card.getByText("Battery 91%")).toBeVisible();
  // The detector learns the background in its first second, then listens.
  await expect(card.getByText("Listening", { exact: true })).toBeVisible({ timeout: 10_000 });

  await card.getByRole("button", { name: "Clench", exact: true }).click();
  await expect(card.getByText("Jaw clench: Keep a moment")).toBeVisible({ timeout: 5000 });
  // Keeping a moment needs listening on; the notice says so, wherever the wearer is.
  await expect(page.getByText("Turn on listening first: a moment is made from the seconds it kept.")).toBeVisible();

  await card.getByRole("button", { name: "Double clench" }).click();
  await expect(card.getByText("Double jaw clench: Rewind and recap")).toBeVisible({ timeout: 5000 });
  // Rewind ran, and says it has nothing kept while it is off.
  await expect(card.getByText("Turn on Rewind first: it can only replay what it has kept.")).toBeVisible();

  await card.getByRole("button", { name: "Turn the head" }).click();
  await expect(card.getByText("30° right")).toBeVisible({ timeout: 5000 });

  // What each gesture does, the jaw first, and changing it takes effect at once.
  const bindings = page.locator("section", { has: page.getByRole("heading", { name: "What each gesture does" }) });
  await expect(bindings.getByRole("combobox", { name: "Held jaw clench" })).toHaveValue("ask_agent");
  await bindings.getByRole("combobox", { name: "Jaw clench", exact: true }).selectOption("rewind");
  await card.getByRole("button", { name: "Clench", exact: true }).click();
  await expect(card.getByText("Jaw clench: Rewind and recap")).toBeVisible({ timeout: 5000 });
  await bindings.getByRole("combobox", { name: "Jaw clench", exact: true }).selectOption("capture_moment");

  await card.getByRole("button", { name: "Disconnect" }).click();
  await expect(card.getByRole("button", { name: "Simulated earbuds" })).toBeVisible();
  await expect(card.getByText("Battery 88%")).toHaveCount(0);
  expect(errors).toEqual([]);
});
