import { expect, test, type Page } from "@playwright/test";
import { fakeMic, startTrial } from "./helpers";

test.use({ launchOptions: fakeMic("en-what-can-you-do") });

/** Each voice's level as the meters show it: left, centre, right. */
const levels = (page: Page) =>
  page.$$eval("[role=meter]", (els) => els.map((e) => Number(e.getAttribute("aria-valuenow"))));

/** Which voice is forward: one at full level, the others well below. */
async function forward(page: Page): Promise<number | null> {
  const v = await levels(page);
  const top = Math.max(...v);
  return top > -3 && v.filter((x) => x > top - 6).length === 1 ? v.indexOf(top) : null;
}

const captureRecap = () => {
  const w = window as unknown as { __recap: string[] };
  w.__recap = [];
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/rewind") && init?.body instanceof FormData) w.__recap.push(String(init.body.get("meta")));
    return orig(input, init);
  };
};

test("focus: the voice you face comes forward, a clench locks it, and you can ask what anyone said", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(captureRecap);
  await startTrial(page);
  await page.goto("/focus");
  await expect(page.locator("section canvas, section [role=img]").first()).toBeVisible();

  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({ timeout: 30_000 });
  // Straight ahead is Daniel, in the middle.
  await expect.poll(() => forward(page)).toBe(1);

  // Arrow keys turn the head 10 degrees at a time; at -50 the left voice comes
  // forward and the others step back by 16 dB.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(() => forward(page)).toBe(0);
  // The levels glide, so wait for them to settle before reading them.
  await expect.poll(async () => (await levels(page))[0]).toBeGreaterThan(-2);
  const [left, centre, right] = await levels(page);
  expect(left).toBeGreaterThan(-2);
  expect(centre).toBeLessThan(-12);
  expect(right).toBeLessThan(-12);

  // At -20, between two people, nobody is forward and all three sit at the same level.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(800);
  expect(await forward(page)).toBeNull();
  expect(new Set(await levels(page)).size).toBe(1);

  // The number keys face a person directly.
  await page.keyboard.press("3");
  await expect.poll(() => forward(page)).toBe(2);

  // J stands in for the jaw clench: it locks onto the barista, wherever the head goes.
  await page.keyboard.press("j");
  await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(800);
  expect(await forward(page)).toBe(2);
  // Let go at -15: the voice in front, Daniel, comes forward again.
  await page.keyboard.press("j");
  await expect.poll(() => forward(page)).toBe(1);

  // What did Emma say: her last seconds go for a recap while everyone steps back.
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "What did they say?" }).first().click();
  await expect.poll(async () => Math.max(...(await levels(page)))).toBeLessThan(-18);
  await expect(page.getByText(/This is a mock recap\. Someone around you said:/)).toBeVisible({ timeout: 20_000 });
  const metas = await page.evaluate(() => (window as unknown as { __recap: string[] }).__recap);
  expect(metas).toHaveLength(1);
  expect(JSON.parse(metas[0]!)).toMatchObject({ speechLang: "en", replyLang: "en" });
  // When the recap has been spoken, the room comes back as it was.
  await expect.poll(() => forward(page), { timeout: 30_000 }).toBe(1);

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
