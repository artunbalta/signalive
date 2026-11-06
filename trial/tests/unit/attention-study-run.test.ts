import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earbuds } from "@/lib/client/earbuds";
import { attentionStudy, spliceListener } from "@/lib/client/studies/attention-runner";
import { claimedCommand } from "@/lib/gestures/claims";

const vendor = join(__dirname, "..", "..", "public");

describe("splicing two listeners into one who switches", () => {
  it("takes each stretch from the person the cue names, the second brought to the first one's level, with short fades", () => {
    const fs = 100;
    const n = 1000;
    const a = [Float32Array.from({ length: n }, (_, i) => 10 + Math.sin(i))];
    const b = [Float32Array.from({ length: n }, (_, i) => -40 + 3 * Math.sin(i))];
    const out = spliceListener(a, b, fs, [
      { from: 0, to: 4000, talker: 0 },
      { from: 4000, to: 7000, talker: 1 },
      { from: 7000, to: 10_000, talker: 0 },
    ])[0]!;
    // Well inside the first and last stretches: the first person exactly.
    expect(out[100]).toBeCloseTo(a[0]![100]!, 5);
    expect(out[900]).toBeCloseTo(a[0]![900]!, 5);
    // Inside the second: the second person at the first one's mean and spread.
    const mid = Array.from(out.subarray(450, 650));
    const mean = mid.reduce((s, v) => s + v, 0) / mid.length;
    expect(Math.abs(mean - 10)).toBeLessThan(0.3);
    // No step at a join: neighbours differ by little more than the signal itself does.
    for (let i = 395; i < 405; i++) expect(Math.abs(out[i + 1]! - out[i]!)).toBeLessThan(2.5);
  });
});

describe("attention study, replayed through the simulated earbuds", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
    // The vendor files scripts/copy-vendor.mjs puts in public/, read from disk.
    vi.stubGlobal("fetch", async (url: string) => {
      const path = join(vendor, url);
      const body = readFileSync(path);
      return new Response(body, { status: 200 });
    });
  });

  afterEach(async () => {
    attentionStudy.reset();
    await earbuds.disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("decodes the spliced listener with the learned model and scores the decisions against the cue", async () => {
    attentionStudy.configure({ source: "replay", participant: "R01" });
    const started = attentionStudy.start();
    // Fetching and connecting take a few turns of the event loop.
    for (let i = 0; i < 50 && attentionStudy.view.get().stage !== "running"; i++) await vi.advanceTimersByTimeAsync(50);
    expect(await started).toBe(true);
    const plan = attentionStudy.view.get().plan!;
    expect(plan.cues.map((c) => c.talker)).toEqual([0, 1, 0]);
    expect(claimedCommand("jaw_clench")).toBe("none");
    for (let t = 0; t < plan.durationMs + 2000; t += 500) await vi.advanceTimersByTimeAsync(500);
    const v = attentionStudy.view.get();
    expect(v.stage).toBe("done");
    // One decision every 10 s once the decoder has filled its window.
    expect(v.decisions.length).toBeGreaterThan(14);
    const s = v.score!;
    expect(s.decisions).toBeGreaterThan(10);
    // Ten second decisions are weak alone (about 62% on people the model never saw); the running belief is what holds.
    expect(s.accuracy!).toBeGreaterThanOrEqual(0.5);
    expect(s.beliefRight!).toBeGreaterThan(0.6);
    expect(s.switches.map((w) => w.at)).toEqual([90_000, 150_000]);
    expect(claimedCommand("jaw_clench")).toBeUndefined();
    const r = attentionStudy.report();
    expect(r).toMatchObject({ study: "attention", source: "replay", participant: "R01" });
    expect(r.envelopes).toHaveLength(2);
  }, 180_000);
});
