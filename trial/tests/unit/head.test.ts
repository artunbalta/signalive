import { describe, expect, it } from "vitest";
import { buildHead, EARBUD, headSdf, MASSETER } from "@/lib/rewind/head";

describe("the Rewind figure", () => {
  const started = performance.now();
  const head = buildHead(20000);
  const ms = performance.now() - started;

  it("builds the requested number of points quickly", () => {
    expect(head.count).toBe(20000);
    // Built in the browser on first view, so it must stay cheap.
    expect(ms).toBeLessThan(1500);
  });

  it("puts every point on the surface, with unit normals", () => {
    for (let i = 0; i < head.count; i += 7) {
      const [x, y, z] = [head.positions[i * 3]!, head.positions[i * 3 + 1]!, head.positions[i * 3 + 2]!];
      expect(Math.abs(headSdf(x, y, z))).toBeLessThan(0.01);
      expect(Math.hypot(head.normals[i * 3]!, head.normals[i * 3 + 1]!, head.normals[i * 3 + 2]!)).toBeCloseTo(1, 3);
    }
  });

  it("is a symmetric bust: both sides, a head above shoulders", () => {
    let left = 0;
    let top = -Infinity;
    let bottom = Infinity;
    let widest = 0;
    for (let i = 0; i < head.count; i++) {
      const x = head.positions[i * 3]!;
      const y = head.positions[i * 3 + 1]!;
      if (x > 0) left++;
      top = Math.max(top, y);
      bottom = Math.min(bottom, y);
      if (y < -1.4) widest = Math.max(widest, Math.abs(x));
    }
    expect(left / head.count).toBeGreaterThan(0.45);
    expect(left / head.count).toBeLessThan(0.55);
    expect(top).toBeGreaterThan(1.4);
    expect(bottom).toBeLessThan(-2.1);
    expect(widest).toBeGreaterThan(1.6);
  });

  it("tags the lower jaw and the masseter, and nothing above the eyes", () => {
    let jawPoints = 0;
    let masseterPoints = 0;
    for (let i = 0; i < head.count; i++) {
      const y = head.positions[i * 3 + 1]!;
      if (head.jaw[i]! > 0.5) {
        jawPoints++;
        expect(y).toBeLessThan(0);
      }
      if (head.masseter[i]! > 0.5) masseterPoints++;
    }
    expect(jawPoints).toBeGreaterThan(200);
    expect(masseterPoints).toBeGreaterThan(50);
  });

  it("places the earbud at the ear and the masseter on the surface's side", () => {
    expect(Math.abs(headSdf(...EARBUD))).toBeLessThan(0.12);
    expect(headSdf(...MASSETER)).toBeLessThan(0.05);
  });

  it("is the same every time", () => {
    const again = buildHead(500);
    const first = buildHead(500);
    expect([...again.positions.slice(0, 30)]).toEqual([...first.positions.slice(0, 30)]);
  });
});
