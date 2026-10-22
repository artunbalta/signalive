import { expect, type Page } from "@playwright/test";
import { join } from "node:path";

/** Chromium flags for a fake microphone that loops one fixture file. */
export function fakeMic(fixture: string) {
  return {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${join(__dirname, "..", "fixtures", "audio", `${fixture}.wav`)}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  };
}

/** Landing, consent, and into setup. */
export async function startTrial(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try with my earbuds" }).click();
  await page.waitForURL("**/consent");
  await page.getByText("I have read this and want to start the trial.").click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForURL("**/setup");
}

export function collectPosts(page: Page, path: string) {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === path) {
      try {
        bodies.push(r.postDataJSON() as Record<string, unknown>);
      } catch {
        // multipart bodies are not JSON
      }
    }
  });
  return bodies;
}

/** Holds the push to talk ring for ms. */
export async function holdRing(page: Page, ms: number) {
  const ring = page.getByRole("button", { name: "Hold to talk" });
  await expect(ring).toBeVisible();
  const box = (await ring.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}
