import { describe, expect, it } from "vitest";
import { fuseAttention } from "./fusion";

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

  it("follows the documented defaults: a 0.2 margin beats facing a talker 60 degrees away", () => {
    const p = fuseAttention({ azimuthsDeg: [0, 60], yawDeg: 0, eeg: { talker: 1, margin: 0.2 } });
    expect(argmax(p)).toBe(1);
    // log odds: kappa * (cos 60 - cos 0) + eegWeight * 0.2 = -1 + 2.
    expect(p[1] / p[0]).toBeCloseTo(Math.E, 9);
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
