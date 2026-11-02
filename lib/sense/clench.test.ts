import { describe, expect, it } from "vitest";
import { ClenchDetector, type ClenchEvent } from "./clench";

/** Small seeded generator (mulberry32), so every run sees the same noise. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal samples by Box and Muller. */
function normal(rand: () => number) {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    const u = 1 - rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

/**
 * A burst of white noise: start and length in seconds, RMS in microvolts, on
 * one side or both, with 10 ms linear ramps inside its length.
 */
type Burst = { at: number; len: number; rms?: number; side?: "both" | "left" | "right" };

/**
 * Frames: L1, L2, an unrelated scalp channel, R1, R2. Every ear channel
 * carries 5 microvolts RMS of white noise and a 10 microvolt 10 Hz rhythm.
 */
const LEFT = [0, 1];
const RIGHT = [3, 4];

function run(opts: { bursts: Burst[]; seconds: number; fs?: number; seed?: number; k?: number }) {
  const fs = opts.fs ?? 500;
  const gauss = normal(mulberry32(opts.seed ?? 1));
  const det = new ClenchDetector({ fs, left: LEFT, right: RIGHT, k: opts.k });
  const events: { event: ClenchEvent; at: number }[] = [];
  const frame = new Float64Array(5);
  const ramp = 0.01;
  for (let n = 0; n < Math.round(opts.seconds * fs); n++) {
    const t = n / fs;
    const alpha = 10 * Math.sin(2 * Math.PI * 10 * t);
    for (let c = 0; c < 5; c++) frame[c] = 5 * gauss() + alpha;
    // The scalp channel is loud and must not matter.
    frame[2] = 300 * gauss();
    for (const b of opts.bursts) {
      if (t < b.at || t >= b.at + b.len) continue;
      const env = Math.min(1, (t - b.at) / ramp, (b.at + b.len - t) / ramp);
      const side = b.side ?? "both";
      const rms = b.rms ?? 40;
      if (side !== "right") for (const c of LEFT) frame[c] += rms * env * gauss();
      if (side !== "left") for (const c of RIGHT) frame[c] += rms * env * gauss();
    }
    const event = det.push(frame);
    if (event) events.push({ event, at: t });
  }
  return { events, det };
}

describe("ClenchDetector", () => {
  it("reports one 200 ms clench as one single, within 700 ms of its onset", () => {
    const { events } = run({ bursts: [{ at: 2, len: 0.2 }], seconds: 5 });
    expect(events.map((e) => e.event.kind)).toEqual(["single"]);
    const [{ event, at }] = events;
    expect(at - 2).toBeLessThan(0.7);
    // Dated at the clench (as seen through the 50 ms RMS), not at the report.
    expect(Math.abs(event.time - 2)).toBeLessThan(0.08);
    expect(event.strength).toBeGreaterThan(4);
  });

  it("works at 250 Hz too", () => {
    const { events } = run({ bursts: [{ at: 2, len: 0.2 }], seconds: 5, fs: 250 });
    expect(events.map((e) => e.event.kind)).toEqual(["single"]);
    expect(events[0].at - 2).toBeLessThan(0.7);
  });

  it("reports two 150 ms clenches 250 ms apart as one double", () => {
    // 250 ms of rest between the end of the first and the start of the second.
    const { events } = run({ bursts: [{ at: 2, len: 0.15 }, { at: 2.4, len: 0.15 }], seconds: 5 });
    expect(events.map((e) => e.event.kind)).toEqual(["double"]);
    expect(Math.abs(events[0].event.time - 2)).toBeLessThan(0.08);
  });

  it("reports two clenches a second apart as two singles", () => {
    const { events } = run({ bursts: [{ at: 2, len: 0.2 }, { at: 3.2, len: 0.2 }], seconds: 6 });
    expect(events.map((e) => e.event.kind)).toEqual(["single", "single"]);
  });

  it("reports a 1.2 s clench as one hold, as it passes 700 ms", () => {
    const { events } = run({ bursts: [{ at: 2, len: 1.2 }], seconds: 5 });
    expect(events.map((e) => e.event.kind)).toEqual(["hold"]);
    expect(events[0].at - 2).toBeGreaterThan(0.7);
    expect(events[0].at - 2).toBeLessThan(0.8);
  });

  it("ignores a burst on one side only", () => {
    expect(run({ bursts: [{ at: 2, len: 0.2, side: "left" }], seconds: 5 }).events).toEqual([]);
    expect(run({ bursts: [{ at: 2, len: 0.4, side: "right", rms: 80 }], seconds: 5 }).events).toEqual([]);
  });

  it("goes quiet once bursts come four in 3 s, as in chewing", () => {
    const bursts = Array.from({ length: 6 }, (_, i) => ({ at: 2 + 0.6 * i, len: 0.12 }));
    const { events } = run({ bursts, seconds: 8 });
    const fourth = bursts[3].at;
    expect(events.filter((e) => e.at >= fourth)).toEqual([]);
    // What came before are separate bites, never a double or a hold.
    expect(events.every((e) => e.event.kind === "single")).toBe(true);
  });

  it("listens again once chewing has stopped", () => {
    const bursts = Array.from({ length: 6 }, (_, i) => ({ at: 2 + 0.6 * i, len: 0.12 }));
    bursts.push({ at: 8, len: 0.2 });
    const { events } = run({ bursts, seconds: 10 });
    const late = events.filter((e) => e.at >= bursts[3].at);
    expect(late.map((e) => e.event.kind)).toEqual(["single"]);
    expect(Math.abs(late[0].event.time - 8)).toBeLessThan(0.08);
  });

  it("ignores weak broadband noise bursts", () => {
    const bursts = Array.from({ length: 5 }, (_, i) => ({ at: 2 + i, len: 0.3, rms: 8 }));
    expect(run({ bursts, seconds: 8 }).events).toEqual([]);
  });

  it("stays silent on background alone, for any seed", () => {
    for (let seed = 1; seed <= 5; seed++) expect(run({ bursts: [], seconds: 20, seed }).events).toEqual([]);
  });

  it("is the same clench whatever the noise", () => {
    for (let seed = 2; seed <= 6; seed++) {
      expect(run({ bursts: [{ at: 2, len: 0.2 }], seconds: 4, seed }).events.map((e) => e.event.kind)).toEqual(["single"]);
      expect(
        run({ bursts: [{ at: 2, len: 0.15 }, { at: 2.4, len: 0.15 }], seconds: 4, seed }).events.map((e) => e.event.kind),
      ).toEqual(["double"]);
    }
  });

  it("detects nothing in the first second, while it learns the floor", () => {
    const { events, det } = run({ bursts: [{ at: 0.3, len: 0.2 }], seconds: 0.9 });
    expect(events).toEqual([]);
    expect(det.ready).toBe(false);
  });

  it("survives samples that are not finite", () => {
    const fs = 500;
    const gauss = normal(mulberry32(9));
    const det = new ClenchDetector({ fs, left: [0], right: [1] });
    const kinds: string[] = [];
    for (let n = 0; n < 4 * fs; n++) {
      const t = n / fs;
      const burst = t >= 2 && t < 2.2 ? 40 : 0;
      const frame = [5 * gauss() + burst * gauss(), 5 * gauss() + burst * gauss()];
      if (n % 97 === 0) frame[0] = NaN;
      const e = det.push(frame);
      if (e) kinds.push(e.kind);
    }
    expect(kinds).toEqual(["single"]);
    expect(det.levels.every(Number.isFinite)).toBe(true);
  });

  it("starts over after reset", () => {
    const { det } = run({ bursts: [], seconds: 2 });
    expect(det.ready).toBe(true);
    det.reset();
    expect(det.ready).toBe(false);
    expect(det.levels).toEqual([0, 0]);
  });

  it("clamps the band below Nyquist and rejects bands that cannot fit", () => {
    expect(new ClenchDetector({ fs: 200, left: [0], right: [1] }).band[1]).toBeLessThan(100);
    expect(() => new ClenchDetector({ fs: 50, left: [0], right: [1] })).toThrow(RangeError);
    expect(() => new ClenchDetector({ fs: 500, left: [], right: [1] })).toThrow(RangeError);
  });
});
