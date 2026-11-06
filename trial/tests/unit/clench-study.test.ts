import { describe, expect, it } from "vitest";
import {
  BARS,
  CLENCH_KINDS,
  EARLIEST_MS,
  RESPONSE_MS,
  planClenchStudy,
  scoreClenchStudy,
  type ClenchStudyPlan,
  type StudyDetection,
} from "@/lib/client/studies/clench-study";

const full = () => planClenchStudy({ perKind: 20, freeMinutes: 20, seed: 42 });

/** Every prompt answered as asked, 900 ms after its cue, reported 600 ms after the jaw moved. */
function perfect(plan: ClenchStudyPlan): StudyDetection[] {
  return plan.prompts.map((p) => ({ kind: p.kind, at: p.at + 900, latencyMs: 600 }));
}

describe("clench study plan", () => {
  it("asks for 20 of each kind, balanced over the four conditions, in order, at gaps of 6 to 15 s", () => {
    const plan = full();
    expect(plan.prompts).toHaveLength(60);
    for (const kind of CLENCH_KINDS) expect(plan.prompts.filter((p) => p.kind === kind)).toHaveLength(20);
    for (const c of ["sitting", "talking", "walking", "chewing"] as const) {
      const here = plan.prompts.filter((p) => p.condition === c);
      expect(here).toHaveLength(15);
      for (const kind of CLENCH_KINDS) expect(here.filter((p) => p.kind === kind)).toHaveLength(5);
    }
    expect(plan.conditionStarts.map((s) => s.condition)).toEqual(["sitting", "talking", "walking", "chewing"]);
    for (let i = 1; i < plan.prompts.length; i++) {
      const gap = plan.prompts[i]!.at - plan.prompts[i - 1]!.at;
      const changed = plan.prompts[i]!.condition !== plan.prompts[i - 1]!.condition;
      expect(gap).toBeGreaterThanOrEqual(6000 - 1);
      expect(gap).toBeLessThanOrEqual(15000 + (changed ? 8000 : 0) + 1);
    }
    expect(plan.freeFrom).toBeGreaterThan(plan.prompts[59]!.at);
    expect(plan.freeTo - plan.freeFrom).toBe(20 * 60_000);
  });

  it("is the same plan for the same seed, and a different one for another", () => {
    expect(planClenchStudy({ perKind: 20, freeMinutes: 20, seed: 7 })).toEqual(planClenchStudy({ perKind: 20, freeMinutes: 20, seed: 7 }));
    const a = planClenchStudy({ perKind: 20, freeMinutes: 20, seed: 7 }).prompts.map((p) => p.kind);
    const b = planClenchStudy({ perKind: 20, freeMinutes: 20, seed: 8 }).prompts.map((p) => p.kind);
    expect(a).not.toEqual(b);
  });

  it("refuses a plan with nothing in it", () => {
    expect(() => planClenchStudy({ perKind: 0, freeMinutes: 1 })).toThrow(RangeError);
    expect(() => planClenchStudy({ perKind: 2, freeMinutes: 1, conditions: [] })).toThrow(RangeError);
  });
});

describe("clench study score", () => {
  it("passes a detector that catches every prompt and stays quiet in the free period", () => {
    const plan = full();
    const s = scoreClenchStudy(plan, perfect(plan));
    expect(s.byKind.single).toMatchObject({ prompted: 20, caught: 20, rate: 1 });
    expect(s.byKind.hold.rate).toBe(1);
    expect(s.byCondition.chewing).toMatchObject({ prompted: 15, caught: 15 });
    expect(s.falseCount).toBe(0);
    expect(s.falsePerHour).toBe(0);
    expect(s.latency).toEqual({ medianMs: 600, p90Ms: 600, n: 20 });
    expect(s.latencyByKind).toEqual({ single: 600, double: 600, hold: 600 });
    expect(s.response.medianMs).toBe(900);
    expect(s.pass).toEqual({ singles: true, falsePerHour: true, latency: true });
  });

  it("tells a misread from a miss, and fills the confusion table", () => {
    const plan = full();
    const dets = perfect(plan);
    const [firstSingle, secondSingle] = plan.prompts.filter((p) => p.kind === "single");
    const firstHold = plan.prompts.find((p) => p.kind === "hold")!;
    // Two singles read as doubles; the first hold never reported.
    dets[firstSingle!.i] = { ...dets[firstSingle!.i]!, kind: "double" };
    dets[secondSingle!.i] = { ...dets[secondSingle!.i]!, kind: "double" };
    dets.splice(firstHold.i, 1);
    const s = scoreClenchStudy(plan, dets);
    expect(s.byKind.single).toMatchObject({ caught: 18, misread: 2, missed: 0 });
    expect(s.byKind.hold).toMatchObject({ caught: 19, misread: 0, missed: 1 });
    expect(s.confusion.single).toEqual({ single: 18, double: 2, hold: 0, none: 0 });
    expect(s.confusion.hold.none).toBe(1);
    expect(s.results[firstSingle!.i]).toMatchObject({ outcome: "misread", detected: "double" });
    // 18 of 20 singles is under the 95% bar; 19 would meet it.
    expect(s.byKind.single.rate).toBeLessThan(BARS.singles);
    expect(s.pass.singles).toBe(false);
    const one = scoreClenchStudy(plan, perfect(plan).map((d, i) => (i === firstSingle!.i ? { ...d, kind: "double" as const } : d)));
    expect(one.byKind.single.rate).toBe(0.95);
    expect(one.pass.singles).toBe(true);
  });

  it("ignores a report too soon after the cue to answer it, and one too late counts for nothing", () => {
    const plan = planClenchStudy({ perKind: 1, freeMinutes: 1, conditions: ["sitting"], seed: 3 });
    const a = plan.prompts[0]!;
    const s = scoreClenchStudy(plan, [
      { kind: a.kind, at: a.at + EARLIEST_MS - 50 },
      { kind: a.kind, at: a.at + RESPONSE_MS + 50 },
    ]);
    expect(s.results[0]!.outcome).toBe("missed");
    expect(s.extra).toBe(2);
    expect(s.falseCount).toBe(0);
  });

  it("gives each detection to one prompt only, in order", () => {
    const plan: ClenchStudyPlan = {
      prompts: [
        { i: 0, kind: "single", condition: "sitting", at: 0 },
        { i: 1, kind: "single", condition: "sitting", at: 2000 },
      ],
      conditionStarts: [{ condition: "sitting", at: 0 }],
      freeFrom: 10_000,
      freeTo: 70_000,
      seed: 1,
    };
    // One clench, late for the first cue and early for the second: it answers the first.
    const s = scoreClenchStudy(plan, [{ kind: "single", at: 2100 }]);
    expect(s.results.map((r) => r.outcome)).toEqual(["caught", "missed"]);
  });

  it("counts reports in the free period as false, per hour, against the bar", () => {
    const plan = full();
    const dets = perfect(plan);
    dets.push({ kind: "single", at: plan.freeFrom + 60_000 }, { kind: "double", at: plan.freeFrom + 600_000 });
    const s = scoreClenchStudy(plan, dets);
    expect(s.falseCount).toBe(2);
    expect(s.freeMinutes).toBe(20);
    expect(s.falsePerHour).toBeCloseTo(6, 10);
    expect(s.pass.falsePerHour).toBe(false);
  });

  it("scores a study stopped early only up to where it got", () => {
    const plan = full();
    const until = plan.prompts[29]!.at + RESPONSE_MS;
    const s = scoreClenchStudy(plan, perfect(plan), until);
    expect(s.results).toHaveLength(30);
    expect(s.freeMinutes).toBe(0);
    expect(s.falsePerHour).toBeNull();
    expect(s.pass.falsePerHour).toBeNull();
  });
});
