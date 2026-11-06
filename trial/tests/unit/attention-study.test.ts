import { describe, expect, it } from "vitest";
import { DECISION_S, cuedAt, envelope64, headTarget, planSwitches, scoreAttention, type StudyDecision, type SwitchPlan } from "@/lib/client/studies/attention-study";

describe("attention study plan", () => {
  it("alternates the cued voice, holding each for 30 to 90 s, from the lead to the end", () => {
    const plan = planSwitches({ minutes: 30, leadMs: 20_000, seed: 9 });
    expect(plan.cues[0]!.from).toBe(20_000);
    expect(plan.cues[plan.cues.length - 1]!.to).toBe(30 * 60_000);
    for (let i = 0; i < plan.cues.length; i++) {
      const c = plan.cues[i]!;
      if (i > 0) {
        expect(c.from).toBe(plan.cues[i - 1]!.to);
        expect(c.talker).toBe(1 - plan.cues[i - 1]!.talker);
      }
      const hold = c.to - c.from;
      if (i < plan.cues.length - 1) {
        expect(hold).toBeGreaterThanOrEqual(30_000);
        expect(hold).toBeLessThanOrEqual(90_000);
      }
    }
    // 30 minutes of 30 to 90 s holds: between 19 and 59 of them.
    expect(plan.cues.length).toBeGreaterThan(18);
    expect(plan.cues.length).toBeLessThan(60);
    expect(planSwitches({ minutes: 30, leadMs: 20_000, seed: 9 })).toEqual(plan);
    expect(cuedAt(plan, 10_000)).toBeNull();
    expect(cuedAt(plan, 20_000)).toBe(plan.cues[0]);
  });

  it("starts with the voice it is told to", () => {
    expect(planSwitches({ minutes: 5, firstTalker: 1, seed: 1 }).cues[0]!.talker).toBe(1);
    expect(planSwitches({ minutes: 5, firstTalker: 0, seed: 1 }).cues[0]!.talker).toBe(0);
  });
});

describe("a voice's envelope", () => {
  it("is the RMS of each 1/64 s, so it follows the speech's loudness", () => {
    const rate = 16000;
    const x = new Float32Array(rate * 2);
    // A 1 kHz tone whose amplitude rises and falls four times a second.
    for (let i = 0; i < x.length; i++) x[i] = (0.5 + 0.5 * Math.sin((2 * Math.PI * 4 * i) / rate)) * Math.sin((2 * Math.PI * 1000 * i) / rate);
    const env = envelope64(x, rate);
    expect(env.length).toBe(128);
    for (let k = 0; k < env.length; k++) {
      const t = (k + 0.5) / 64;
      const amp = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
      expect(env[k]!).toBeCloseTo(amp / Math.SQRT2, 1);
    }
  });
});

/** Decisions every 10 s: wrong for the first `lag` seconds after each switch, right afterwards; the belief follows at `follow`. */
function decide(plan: SwitchPlan, lag: number, follow: number): StudyDecision[] {
  const out: StudyDecision[] = [];
  for (let start = 0; start + DECISION_S * 1000 <= plan.durationMs; start += DECISION_S * 1000) {
    const end = start + DECISION_S * 1000;
    const cue = cuedAt(plan, start) ?? plan.cues[0]!;
    const since = (end - cue.from) / 1000;
    const talker = since > lag ? cue.talker : 1 - cue.talker;
    const p = since >= follow ? 0.9 : 0.1;
    out.push({ startMs: start, endMs: end, talker, margin: 0.01, belief: cue.talker === 0 ? [p, 1 - p] : [1 - p, p] });
  }
  return out;
}

describe("attention study score", () => {
  const plan: SwitchPlan = {
    cues: [
      { from: 0, to: 60_000, talker: 0 },
      { from: 60_000, to: 150_000, talker: 1 },
      { from: 150_000, to: 240_000, talker: 0 },
    ],
    durationMs: 240_000,
    seed: 1,
  };

  it("counts decisions within one cue, by time since the switch, and times each switch", () => {
    const s = scoreAttention(plan, decide(plan, 20, 40));
    // 24 windows of 10 s, none straddling a switch here.
    expect(s.decisions).toBe(24);
    // The first two windows after each cue start (since 10 and 20 s) are wrong.
    expect(s.right).toBe(24 - 6);
    expect(s.bySinceSwitch[0]).toMatchObject({ fromS: 0, toS: 20, n: 3 + 0, accuracy: 0 });
    expect(s.switches.map((x) => [x.at, x.to, x.settled, x.tookMs])).toEqual([
      [60_000, 1, true, 40_000],
      [150_000, 0, true, 40_000],
    ]);
    expect(s.followed).toBe(2);
    expect(s.switchMedianMs).toBe(40_000);
  });

  it("does not time switches when the belief is behind the cue all along", () => {
    // The belief only comes over 100 s after each cue: before every switch it was on the wrong voice.
    const s = scoreAttention(plan, decide(plan, 20, 100));
    expect(s.switches.map((x) => x.settled)).toEqual([false, false]);
    expect(s.followed).toBe(0);
    expect(s.missed).toBe(0);
    expect(s.switchMedianMs).toBeNull();
  });

  it("times only a switch the belief was settled before: one already on the new voice was wrong, not quick", () => {
    // The belief never leaves voice 0: right before the second switch, wrong before the first.
    const stuck = decide(plan, 0, 0).map((d) => ({ ...d, belief: [0.9, 0.1] }));
    const s = scoreAttention(plan, stuck);
    expect(s.switches.map((x) => [x.at, x.settled])).toEqual([
      [60_000, true],
      [150_000, false],
    ]);
    // The first is missed (never comes over to voice 1); the second is not timed at all.
    expect(s.missed).toBe(1);
    expect(s.followed).toBe(0);
    expect(s.switchMedianMs).toBeNull();
  });

  it("leaves out a window that straddles a switch, and a switch the study stopped on", () => {
    const shifted = decide(plan, 0, 0).map((d) => ({ ...d, startMs: d.startMs + 5000, endMs: d.endMs + 5000 }));
    const s = scoreAttention(plan, shifted);
    // Windows 55 to 65 s and 145 to 155 s heard both voices.
    expect(s.decisions).toBe(21);
    const early = scoreAttention(plan, decide(plan, 20, 40), 170_000);
    expect(early.switches.map((x) => x.at)).toEqual([60_000]);
  });
});

describe("where the listener faces (experiment 3)", () => {
  it("gives every round of three cues each head condition once, and says where to point", () => {
    const plan = planSwitches({ minutes: 30, leadMs: 20_000, head: true, seed: 4 });
    for (let i = 0; i + 3 <= plan.cues.length; i += 3) {
      expect(plan.cues.slice(i, i + 3).map((c) => c.head).sort()).toEqual(["ahead", "away", "toward"]);
    }
    const az = [-60, 60];
    expect(headTarget({ from: 0, to: 1, talker: 0, head: "toward" }, az)).toBe(-60);
    expect(headTarget({ from: 0, to: 1, talker: 0, head: "away" }, az)).toBe(60);
    expect(headTarget({ from: 0, to: 1, talker: 1, head: "ahead" }, az)).toBe(0);
    expect(headTarget({ from: 0, to: 1, talker: 1 }, az)).toBeNull();
    expect(planSwitches({ minutes: 5, seed: 4 }).cues.every((c) => c.head === undefined)).toBe(true);
  });

  it("scores the EEG, the head and the two together for each condition", () => {
    const plan: SwitchPlan = {
      cues: [
        { from: 0, to: 60_000, talker: 0, head: "toward" },
        { from: 60_000, to: 120_000, talker: 1, head: "away" },
        { from: 120_000, to: 180_000, talker: 0, head: "ahead" },
      ],
      durationMs: 180_000,
      seed: 1,
    };
    const decisions: StudyDecision[] = [];
    for (let start = 0; start + 10_000 <= 180_000; start += 10_000) {
      const cue = cuedAt(plan, start)!;
      const yaw = cue.head === "ahead" ? 2 : headTarget(cue, [-60, 60]);
      // The EEG is always right; the fused estimate follows the head where it points, the EEG where it does not.
      const fusedTalker = cue.head === "away" ? 1 - cue.talker : cue.talker;
      const posterior = fusedTalker === 0 ? [0.7, 0.3] : [0.3, 0.7];
      decisions.push({ startMs: start, endMs: start + 10_000, talker: cue.talker, margin: 0.01, belief: [0.5, 0.5], yawDeg: yaw, posterior });
    }
    const s = scoreAttention(plan, decisions);
    expect(s.byHead.toward).toEqual({ decisions: 6, eeg: 1, head: 1, fused: 1 });
    expect(s.byHead.away).toEqual({ decisions: 6, eeg: 1, head: 0, fused: 0 });
    // Ahead the head leans neither way: a half each.
    expect(s.byHead.ahead).toEqual({ decisions: 6, eeg: 1, head: 0.5, fused: 1 });
  });
});
