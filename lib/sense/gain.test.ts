import { describe, expect, it } from "vitest";
import { GainController } from "./gain";

describe("GainController with two talkers", () => {
  it("starts neutral", () => {
    const g = new GainController({ talkers: 2, steps: 3 });
    expect(g.position()).toEqual([0]);
    expect(g.gainsDb()).toEqual([0, 0]);
    expect(g.gains()).toEqual([1, 1]);
  });

  it("moves one step toward each decoded talker and clamps at the ends", () => {
    const g = new GainController({ talkers: 2, steps: 3 });
    g.update(1);
    expect(g.position()).toEqual([1]);
    for (let i = 0; i < 10; i++) g.update(1);
    expect(g.position()).toEqual([3]);
    g.update(0);
    expect(g.position()).toEqual([2]);
    for (let i = 0; i < 10; i++) g.update(0);
    expect(g.position()).toEqual([-3]);
  });

  it("boosts the favoured talker and attenuates the other in proportion", () => {
    const g = new GainController({ talkers: 2, steps: 3 });
    g.update(0);
    expect(g.gainsDb()[0]).toBeCloseTo(3, 12);
    expect(g.gainsDb()[1]).toBeCloseTo(-3, 12);
    g.update(0);
    g.update(0);
    expect(g.gainsDb()).toEqual([9, -9]);
    const [a, b] = g.gains();
    expect(a).toBeCloseTo(10 ** (9 / 20), 12);
    expect(b).toBeCloseTo(10 ** (-9 / 20), 12);
  });

  it("takes a custom maximum boost", () => {
    const g = new GainController({ talkers: 2, steps: 4, maxBoostDb: 6 });
    g.update(1);
    g.update(1);
    expect(g.gainsDb()).toEqual([-3, 3]);
  });

  it("drifts to the attended talker when most decisions are right", () => {
    // 75 % correct decisions, seeded: the chain spends most of its time near
    // talker 1, and one wrong decision moves it a single step.
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const g = new GainController({ talkers: 2, steps: 5 });
    let favoured = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const before = g.position()[0];
      g.update(rand() < 0.75 ? 1 : 0);
      expect(Math.abs(g.position()[0] - before)).toBeLessThanOrEqual(1);
      if (g.gainsDb()[1] > 0) favoured++;
    }
    expect(favoured / n).toBeGreaterThan(0.9);
  });
});

describe("GainController with more talkers", () => {
  it("raises the decided talker and lowers the rest, within [0, steps]", () => {
    const g = new GainController({ talkers: 3, steps: 3 });
    expect(g.position()).toEqual([0, 0, 0]);
    g.update(2);
    expect(g.position()).toEqual([0, 0, 1]);
    for (let i = 0; i < 5; i++) g.update(2);
    expect(g.position()).toEqual([0, 0, 3]);
    g.update(0);
    expect(g.position()).toEqual([1, 0, 2]);
  });

  it("boosts the leader and attenuates the others by its lead", () => {
    const g = new GainController({ talkers: 3, steps: 3 });
    expect(g.gainsDb()).toEqual([0, 0, 0]);
    for (let i = 0; i < 3; i++) g.update(1);
    expect(g.gainsDb()).toEqual([-9, 9, -9]);
    // Attention moves to talker 0: it is restored step by step.
    g.update(0);
    expect(g.position()).toEqual([1, 2, 0]);
    expect(g.gainsDb()).toEqual([-3, 3, -6]);
    g.update(0);
    g.update(0);
    expect(g.gainsDb()).toEqual([9, -9, -9]);
  });

  it("is neutral with a single talker", () => {
    const g = new GainController({ talkers: 1, steps: 3 });
    g.update(0);
    expect(g.gainsDb()).toEqual([0]);
    expect(g.position()).toEqual([0]);
  });

  it("resets to neutral and rejects bad input", () => {
    const g = new GainController({ talkers: 3, steps: 2 });
    g.update(1);
    g.reset();
    expect(g.position()).toEqual([0, 0, 0]);
    expect(() => g.update(3)).toThrow(RangeError);
    expect(() => new GainController({ talkers: 2, steps: 0 })).toThrow(RangeError);
    expect(() => new GainController({ talkers: 0, steps: 2 })).toThrow(RangeError);
  });
});
