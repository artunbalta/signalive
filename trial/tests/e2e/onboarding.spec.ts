import { expect, test } from "@playwright/test";
import { collectPosts, fakeMic, holdRing, startTrial } from "./helpers";

test.use({ launchOptions: fakeMic("en-what-can-you-do") });

test("landing to a spoken reply, with every stage timed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const latency = collectPosts(page, "/api/latency");
  const profiles = collectPosts(page, "/api/device-profile");

  await startTrial(page);

  // Step 1: devices
  await page.getByRole("button", { name: "Allow microphone" }).click();
  await expect(page.getByRole("combobox", { name: "Microphone" })).toBeVisible();
  await page.getByRole("button", { name: "Play a test sound" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 2: mic check (five seconds of the looping fixture)
  await page.getByRole("button", { name: "Start 5 second check" }).click();
  await expect(page.getByText("Usable bandwidth")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Mic sample rate")).toBeVisible();
  await expect.poll(() => profiles.length).toBeGreaterThan(0);
  expect(profiles[0]).toMatchObject({ contextSampleRate: expect.any(Number) });
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 3: wind test, skipped
  await page.getByRole("button", { name: "Skip" }).click();

  // Step 4: hold through a whole loop of the fixture, so the speech is in it
  await holdRing(page, 6800);
  await expect(page.getByText(/The reply started .* after you stopped/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/From opening the page to this reply/)).toBeVisible({ timeout: 15_000 });

  const turn = latency.find((e) => e.kind === "turn");
  expect(turn).toBeTruthy();
  expect(turn).toMatchObject({ inputMode: "ptt", sttMode: "batch" });
  for (const key of ["sttFinalMs", "llmFirstTokenMs", "firstSentenceMs", "ttsFirstAudioMs", "playbackStartMs"]) {
    expect(turn![key], key).toEqual(expect.any(Number));
  }
  // Stages happen in order after capture end.
  expect(turn!.sttFinalMs as number).toBeLessThanOrEqual(turn!.llmFirstTokenMs as number);
  expect(turn!.ttsFirstAudioMs as number).toBeLessThanOrEqual((turn!.playbackStartMs as number) + 1);
  const onboarding = latency.find((e) => e.kind === "onboarding");
  expect(onboarding?.sinceLandingMs).toEqual(expect.any(Number));
  expect(onboarding!.sinceLandingMs as number).toBeLessThan(3 * 60_000);

  // The server stored them (not just received the requests).
  const stored = await page.evaluate(async () => {
    const id = JSON.parse(localStorage.getItem("signalive.trial.v1") ?? "{}").devUserId as string;
    const res = await fetch("/api/latency?limit=10", { headers: { Authorization: `Bearer dev.${id}` } });
    return (await res.json()) as { kind: string; playbackStartMs: number | null }[];
  });
  expect(stored.filter((e) => e.kind === "turn" && e.playbackStartMs !== null).length).toBeGreaterThan(0);
  expect(stored.some((e) => e.kind === "onboarding")).toBe(true);

  await page.getByRole("button", { name: "Go to the assistant" }).click();
  await page.waitForURL("**/assistant");
  expect(errors).toEqual([]);
});
