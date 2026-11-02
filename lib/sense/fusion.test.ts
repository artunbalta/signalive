import { describe, expect, it } from "vitest";
import { AttentionBelief, DEFAULT_EEG_WEIGHT, DEFAULT_HAZARD, fuseAttention } from "./fusion";

const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
const argmax = (x: number[]) => x.indexOf(Math.max(...x));

describe("fuseAttention", () => {
  const azimuthsDeg = [-60, 0, 60];

  it("gives the talker being faced the highest posterior", () => {
    for (const [yawDeg, faced] of [[0, 1], [-60, 0], [60, 2], [50, 2], [-35, 0]] as const) {
      const p = fuseAttention({ azimuthsDeg, yawDeg });
      expect(argmax(p)).toBe(faced);
    }
  });

  it("is uniform with no orientation and no EEG", () => {
    const p = fuseAttention({ azimuthsDeg });
    p.forEach((x) => expect(x).toBeCloseTo(1 / 3, 12));
  });

  it("lets strong EEG evidence for another talker overturn a weak orientation prior", () => {
    const weak = { azimuthsDeg, yawDeg: 0, kappa: 0.5 };
    expect(argmax(fuseAttention(weak))).toBe(1);
    const p = fuseAttention({ ...weak, eeg: { talker: 2, margin: 0.3 } });
    expect(argmax(p)).toBe(2);
  });

  it("keeps a strong orientation prior against weak EEG evidence", () => {
    const p = fuseAttention({ azimuthsDeg: [0, 180], yawDeg: 0, kappa: 4, eeg: { talker: 1, margin: 0.05 } });
    expect(argmax(p)).toBe(0);
  });

  it("follows the documented defaults: one 0.2 margin decision does not beat facing a talker 60 degrees away", () => {
    expect(DEFAULT_EEG_WEIGHT).toBe(3);
    const p = fuseAttention({ azimuthsDeg: [0, 60], yawDeg: 0, eeg: { talker: 1, margin: 0.2 } });
    expect(argmax(p)).toBe(0);
    // log odds: kappa * (cos 60 - cos 0) + eegWeight * 0.2 = -1 + 0.6.
    expect(p[1] / p[0]).toBeCloseTo(Math.exp(-0.4), 9);
  });

  it("takes a belief in place of one decision, and it can overturn the head", () => {
    const p = fuseAttention({ azimuthsDeg: [0, 60], yawDeg: 0, belief: [0.1, 0.9] });
    // log odds: -1 + log(9).
    expect(p[1] / p[0]).toBeCloseTo(9 / Math.E, 9);
    expect(argmax(p)).toBe(1);
    // A belief wins over a single decision given alongside it: the decision is already in it.
    const q = fuseAttention({ azimuthsDeg: [0, 60], belief: [0.5, 0.5], eeg: { talker: 1, margin: 1 } });
    q.forEach((x) => expect(x).toBeCloseTo(0.5, 12));
    expect(() => fuseAttention({ azimuthsDeg: [0, 60], belief: [1] })).toThrow(RangeError);
  });

  it("sums to 1, including at extreme weights", () => {
    const cases = [
      fuseAttention({ azimuthsDeg, yawDeg: 10 }),
      fuseAttention({ azimuthsDeg, yawDeg: 10, eeg: { talker: 0, margin: 0.4 } }),
      fuseAttention({ azimuthsDeg, yawDeg: 10, kappa: 2000, eegWeight: 5000, eeg: { talker: 2, margin: 1 } }),
      fuseAttention({ azimuthsDeg: [0, 90, 180, 270], eeg: null }),
    ];
    for (const p of cases) {
      expect(sum(p)).toBeCloseTo(1, 12);
      p.forEach((x) => expect(Number.isFinite(x) && x >= 0).toBe(true));
    }
  });

  it("handles no talkers and rejects evidence for a talker that is not there", () => {
    expect(fuseAttention({ azimuthsDeg: [] })).toEqual([]);
    expect(() => fuseAttention({ azimuthsDeg, eeg: { talker: 3, margin: 0.1 } })).toThrow(RangeError);
  });
});

describe("AttentionBelief", () => {
  // research/aad/belief.py's follow() on these margins (signed toward talker 0), weight 3, hazard 0.02.
  const margins = [0.2749, -0.2767, 0.0802, -0.0381, -0.0243, 0.0041, -0.2124, 0.0022, -0.0738, 0.4288, 0.0571, -0.0123, -0.0038, -0.0502, -0.0966, -0.0169, 0.0878, 0.0014, 0.1449, 0.006, 0.0329, 0.2155, 0.0954, -0.0306];
  const expected = [0.695233107861, 0.48950220069, 0.549904041136, 0.519470450461, 0.500475346846, 0.503531274385, 0.348954112071, 0.356508617006, 0.312809051417, 0.630413543164, 0.664400412156, 0.64947081974, 0.640872455701, 0.599684989372, 0.524423048304, 0.510786660312, 0.575622017449, 0.573624686486, 0.672458325393, 0.66955459828, 0.68446623832, 0.800100008043, 0.831974580583, 0.804668918312];

  it("matches the research filter number for number", () => {
    const b = new AttentionBelief({ talkers: 2, weight: 3, hazard: 0.02 });
    margins.forEach((m, i) => {
      b.update({ talker: m >= 0 ? 0 : 1, margin: Math.abs(m) });
      expect(b.probabilities[0]).toBeCloseTo(expected[i], 11);
    });
    expect(b.decisions).toBe(margins.length);
  });

  it("starts even, uses the calibrated defaults, and resets", () => {
    const b = new AttentionBelief({ talkers: 3 });
    expect(b.weight).toBe(DEFAULT_EEG_WEIGHT);
    expect(b.hazard).toBe(DEFAULT_HAZARD);
    b.probabilities.forEach((p) => expect(p).toBeCloseTo(1 / 3, 12));
    b.update({ talker: 2, margin: 0.5 });
    expect(argmax(b.probabilities)).toBe(2);
    b.reset();
    b.probabilities.forEach((p) => expect(p).toBeCloseTo(1 / 3, 12));
    expect(b.decisions).toBe(0);
  });

  it("builds up from weak decisions, and comes over after a switch", () => {
    const b = new AttentionBelief({ talkers: 2 });
    // Weak decisions, right three times in five and won more clearly when right: about what ten seconds of EEG gives.
    const run = (talker: number, n: number) => {
      for (let i = 0; i < n; i++) b.update(i % 5 < 3 ? { talker, margin: 0.12 } : { talker: 1 - talker, margin: 0.06 });
    };
    run(0, 30);
    expect(b.probabilities[0]).toBeGreaterThan(0.75);
    run(1, 30);
    expect(b.probabilities[1]).toBeGreaterThan(0.75);
  });

  it("never becomes certain while attention may move", () => {
    const b = new AttentionBelief({ talkers: 2, hazard: 0.05 });
    for (let i = 0; i < 500; i++) b.update({ talker: 0, margin: 0.2 });
    const p = b.probabilities[0];
    expect(p).toBeLessThan(1);
    // The fixed point of p = g(p): one more decision leaves it where it was.
    b.update({ talker: 0, margin: 0.2 });
    expect(b.probabilities[0]).toBeCloseTo(p, 12);
  });

  it("lets time pass on a decision without a margin, and refuses a talker that is not there", () => {
    const b = new AttentionBelief({ talkers: 2, hazard: 0.1 });
    b.update({ talker: 0, margin: 1 });
    const before = b.probabilities[0];
    b.update({ talker: 0, margin: NaN });
    expect(b.probabilities[0]).toBeCloseTo(0.9 * before + 0.1 * (1 - before), 12);
    expect(() => b.update({ talker: 2, margin: 0.1 })).toThrow(RangeError);
    expect(() => new AttentionBelief({ talkers: 2, hazard: 2 })).toThrow(RangeError);
  });
});
