import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earbuds } from "@/lib/client/earbuds";
import { QUICK_STUDY, clenchStudy } from "@/lib/client/studies/clench-runner";
import { gestureBus } from "@/lib/gestures/bus";
import { claimedCommand } from "@/lib/gestures/claims";

/**
 * The whole clench study on the simulated earbuds, in simulated time: the
 * twin's frames, the phone session, the clench detector, the gesture bus and
 * the study's scoring, with the simulated participant answering the cues.
 */
describe("clench study on the simulated earbuds", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  });

  afterEach(async () => {
    clenchStudy.reset();
    await earbuds.disconnect();
    vi.useRealTimers();
  });

  async function connected() {
    await earbuds.connect("simulated");
    // The detector learns the background in its first second.
    await vi.advanceTimersByTimeAsync(1500);
    expect(earbuds.view.get()).toMatchObject({ phase: "connected", listening: true });
  }

  it("refuses to start with nothing connected", () => {
    expect(clenchStudy.start()).toBe(false);
    expect(clenchStudy.view.get()).toMatchObject({ stage: "setup", error: "not_connected" });
  });

  it("cues every prompt, takes the detector's reports and scores them; the jaw gestures do nothing else meanwhile", async () => {
    await connected();
    clenchStudy.configure({ ...QUICK_STUDY, participant: "T01", simulate: true, seed: 11 });
    expect(clenchStudy.start()).toBe(true);
    const plan = clenchStudy.view.get().plan!;
    expect(plan.prompts).toHaveLength(6);
    // While the study runs, a clench must not keep a moment.
    expect(claimedCommand("jaw_clench")).toBe("none");
    expect(claimedCommand("jaw_hold")).toBe("none");

    const seen: string[] = [];
    const off = gestureBus.subscribe((e) => seen.push(e.type));
    for (let t = 0; t < plan.freeTo + 1000; t += 250) await vi.advanceTimersByTimeAsync(250);
    off();

    const v = clenchStudy.view.get();
    expect(v.stage).toBe("done");
    expect(v.stoppedEarly).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
    const s = v.score!;
    expect(s.results).toHaveLength(6);
    // The simulated participant answers about 96% of cues, about 97% of them with the right kind.
    const caught = s.results.filter((r) => r.outcome === "caught").length;
    expect(caught).toBeGreaterThanOrEqual(4);
    // Every caught single carries the detector's own latency, about 650 ms for a 200 ms clench.
    expect(s.latency.n).toBeGreaterThan(0);
    expect(s.latency.medianMs!).toBeGreaterThan(400);
    expect(s.latency.medianMs!).toBeLessThan(900);
    expect(s.freeMinutes).toBeCloseTo(QUICK_STUDY.freeMinutes, 5);
    // The meal in the free period: its first bites were reported as clenches, then taken back as chewing.
    expect(v.withdrawn.length).toBeGreaterThan(0);
    expect(s.falseCount).toBe(0);
    // The claims are released with the study.
    expect(claimedCommand("jaw_clench")).toBeUndefined();

    const r = clenchStudy.report();
    expect(r).toMatchObject({ study: "clench", participant: "T01", transport: "simulated", simulatedParticipant: true });
    expect(r.prompts).toHaveLength(6);
  }, 120_000);

  it("stops early and scores up to where it got", async () => {
    await connected();
    clenchStudy.configure({ ...QUICK_STUDY, simulate: true, seed: 3 });
    clenchStudy.start();
    const plan = clenchStudy.view.get().plan!;
    await vi.advanceTimersByTimeAsync(plan.prompts[2]!.at + 4000);
    clenchStudy.stop();
    const v = clenchStudy.view.get();
    expect(v.stage).toBe("done");
    expect(v.stoppedEarly).toBe(true);
    expect(v.score!.results.length).toBeGreaterThanOrEqual(3);
    expect(v.score!.results.length).toBeLessThan(6);
    expect(claimedCommand("jaw_double_clench")).toBeUndefined();
  });

  it("keeps the raw signal when asked, every electrode", async () => {
    await connected();
    clenchStudy.configure({ ...QUICK_STUDY, simulate: false, record: true, seed: 5 });
    clenchStudy.start();
    await vi.advanceTimersByTimeAsync(5000);
    clenchStudy.stop();
    expect(clenchStudy.hasRaw).toBe(true);
    // Eight electrodes at 500 Hz for about five seconds.
    expect(clenchStudy.view.get().recorded).toBeGreaterThan(8 * 500 * 4);
  });
});
