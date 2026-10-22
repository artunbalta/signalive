import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fakeMic, startTrial } from "./helpers";

/**
 * Head tracking from real camera frames. scripts/make-test-video.mjs renders a
 * scanned head straight ahead, turning to one side and back, one video per
 * side. Because each video only ever turns one way, the voice that comes
 * forward proves the direction: the right-turn video must never bring the
 * left voice forward, and the other way round. Each side is its own spec
 * file, because the fake camera is a browser launch flag.
 */
export const turningVideo = (side: "right" | "left") => join(__dirname, "..", "fixtures", "video", `head-turn-${side}.y4m`);

export function cameraLaunch(side: "right" | "left") {
  return { args: [...fakeMic("en-what-can-you-do").args, `--use-file-for-fake-video-capture=${turningVideo(side)}`] };
}

async function forward(page: Page): Promise<number | null> {
  const v = await page.$$eval("[role=meter]", (els) => els.map((e) => Number(e.getAttribute("aria-valuenow"))));
  const top = Math.max(...v);
  return top > -3 && v.filter((x) => x > top - 6).length === 1 ? v.indexOf(top) : null;
}

export function headTurnTest(side: "right" | "left") {
  const expected = side === "right" ? 2 : 0;
  const never = side === "right" ? 0 : 2;
  test.skip(!existsSync(turningVideo(side)), "camera fixtures missing: run npm run test:video-fixtures");

  test(`focus with the camera: a head turning ${side} brings the ${side} voice forward, and never the other side`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startTrial(page);
    await page.goto("/focus");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("radio", { name: "Camera" }).click();
    await expect(page.getByText("Following your head")).toBeVisible({ timeout: 90_000 });

    // Two loops of the 9.5 s video.
    const seen: (number | null)[] = [];
    for (let i = 0; i < 100; i++) {
      seen.push(await forward(page));
      await page.waitForTimeout(200);
    }
    const voices = seen.filter((x): x is number => x !== null);
    console.log(`head turning ${side}, forward voice every 200 ms:`, seen.map((x) => (x === null ? "-" : x)).join(""));
    expect(voices).toContain(expected);
    expect(voices).toContain(1);
    expect(voices).not.toContain(never);
    expect(errors).toEqual([]);
  });
}
