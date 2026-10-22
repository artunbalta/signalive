import { expect, test } from "@playwright/test";
import { collectPosts, fakeMic, startTrial } from "./helpers";

test.use({ launchOptions: fakeMic("en-what-can-you-do") });

test("hands-free: the Silero VAD finds the utterance and a turn follows", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const latency = collectPosts(page, "/api/latency");

  await startTrial(page);
  await page.goto("/assistant");
  await page.getByRole("radio", { name: "Hands-free" }).click();
  await expect(page.getByText("Listening. Just start talking.")).toBeVisible({ timeout: 30_000 });

  // The fixture loops every 6.4 s; one utterance must be detected and answered.
  await expect(page.getByText("This is a mock transcript of what you said.").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => latency.filter((e) => e.inputMode === "vad").length, { timeout: 30_000 }).toBeGreaterThan(0);
  const turn = latency.find((e) => e.inputMode === "vad")!;
  // End of speech detection is measured: the VAD's wait after the last voiced frame.
  expect(turn.endpointingMs).toEqual(expect.any(Number));
  expect(turn.endpointingMs as number).toBeGreaterThan(300);
  expect(turn.playbackStartMs).toEqual(expect.any(Number));

  // Back to push to talk.
  await page.getByRole("radio", { name: "Push to talk" }).click();
  await expect(page.getByRole("button", { name: "Hold to talk" })).toBeVisible();
  expect(errors).toEqual([]);
});
