import { describe, expect, it } from "vitest";
import { bootstrapRate, corpusRate, percentile, seededRandom } from "@/lib/shared/stats";

describe("percentile", () => {
  it("interpolates between closest ranks", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(percentile([5, 1, 3], 100)).toBe(5);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, Number.NaN, 3], 50)).toBe(2);
  });
});

describe("seededRandom", () => {
  it("is deterministic and in [0, 1)", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("bootstrapRate", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    errors: i % 4 === 0 ? 2 : 0,
    total: 8,
    cluster: `take-${i}`,
  }));

  it("returns the corpus rate as the point estimate", () => {
    const est = bootstrapRate(rows);
    expect(est.rate).toBeCloseTo(corpusRate(rows)!);
    expect(est.rate).toBeCloseTo(20 / 320);
    expect(est.n).toBe(40);
    expect(est.rows).toBe(40);
  });

  it("produces an interval around the estimate, reproducibly", () => {
    const a = bootstrapRate(rows);
    const b = bootstrapRate(rows);
    expect(a).toEqual(b);
    expect(a.lo!).toBeLessThanOrEqual(a.rate!);
    expect(a.hi!).toBeGreaterThanOrEqual(a.rate!);
    expect(a.hi! - a.lo!).toBeGreaterThan(0);
  });

  it("resamples whole clusters", () => {
    // One take scored by three providers is one observation, not three.
    const clustered = rows.flatMap((r) => [r, { ...r }, { ...r }]);
    const est = bootstrapRate(clustered);
    expect(est.n).toBe(40);
    expect(est.rows).toBe(120);
    expect(est.rate).toBeCloseTo(20 / 320);
  });

  it("reports no interval for fewer than two clusters", () => {
    const est = bootstrapRate([{ errors: 1, total: 4, cluster: "only" }]);
    expect(est.rate).toBe(0.25);
    expect(est.lo).toBeNull();
    expect(est.hi).toBeNull();
    expect(bootstrapRate([]).rate).toBeNull();
  });
});
