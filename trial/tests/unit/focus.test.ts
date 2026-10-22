import { describe, expect, it } from "vitest";
import { headYaw, median, steering, STEER_MAX } from "@/lib/focus/head-pose";
import { facedSpeaker, FOCUS_SPEAKERS, loopTail, splitScript, startAfterPause } from "@/lib/shared/focus";

/** A column-major 4x4 rotating the face by `deg` about the vertical axis (positive turns it left). */
function turnedBy(deg: number) {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), 0, -Math.sin(r), 0, 0, 1, 0, 0, Math.sin(r), 0, Math.cos(r), 0, 0, 0, -50, 1];
}

// Measured: MediaPipe's matrices for the rendered scanned head (scripts/make-test-video.mjs).
const MEASURED = {
  straight: [1, -0.005, 0.029, 0, 0.004, 1, 0.009, 0, -0.029, -0.009, 1, 0],
  right38: [0.832, -0.056, 0.552, 0, 0.043, 0.998, 0.037, 0, -0.553, -0.007, 0.833, 0],
  left38: [0.825, 0.033, -0.564, 0, -0.043, 0.999, -0.004, 0, 0.563, 0.027, 0.826, 0],
};

describe("head direction", () => {
  it("reads straight ahead as about zero", () => {
    expect(headYaw(turnedBy(0))).toBeCloseTo(0, 6);
    expect(Math.abs(headYaw(MEASURED.straight)!)).toBeLessThan(3);
  });

  it("reads a head turned to its right as positive, to its left as negative", () => {
    expect(headYaw(MEASURED.right38)!).toBeGreaterThan(30);
    expect(headYaw(MEASURED.left38)!).toBeLessThan(-30);
    expect(headYaw(turnedBy(-25))!).toBeCloseTo(25, 6);
    expect(headYaw(turnedBy(25))!).toBeCloseTo(-25, 6);
  });

  it("gives up on an unusable matrix", () => {
    expect(headYaw([])).toBeNull();
    expect(headYaw(new Array(16).fill(0))).toBeNull();
  });

  it("steers relative to straight ahead, amplified and bounded", () => {
    expect(steering(10, 10)).toBe(0);
    expect(steering(30, 0)).toBeCloseTo(48, 6);
    expect(steering(-200, 0)).toBe(-STEER_MAX);
    expect(median([5, 1, 3, 100, 2])).toBe(3);
  });

  it("brings the side voices within reach of a measured 38 degree turn", () => {
    const straight = headYaw(MEASURED.straight)!;
    expect(facedSpeaker(steering(headYaw(MEASURED.right38)!, straight))?.index).toBe(2);
    expect(facedSpeaker(steering(headYaw(MEASURED.left38)!, straight))?.index).toBe(0);
  });
});

describe("facing a speaker", () => {
  it("picks the speaker the head points at, squarely or near the edge", () => {
    expect(facedSpeaker(0)).toEqual({ index: 1, confidence: 1 });
    expect(facedSpeaker(-45)?.index).toBe(0);
    expect(facedSpeaker(50)?.index).toBe(2);
    expect(facedSpeaker(40)!.confidence).toBeGreaterThan(0.5);
  });

  it("picks no one between speakers, and the outermost one when turned past them", () => {
    expect(facedSpeaker(22)).toBeNull();
    expect(facedSpeaker(-24)).toBeNull();
    expect(facedSpeaker(70)).toEqual({ index: 2, confidence: 1 });
    expect(facedSpeaker(-80)).toEqual({ index: 0, confidence: 1 });
  });

  it("has three distinct voices around the listener, each scripted in both languages", () => {
    expect(FOCUS_SPEAKERS.map((s) => s.azimuth)).toEqual([-45, 0, 45]);
    expect(new Set(FOCUS_SPEAKERS.map((s) => s.voice)).size).toBe(3);
    for (const s of FOCUS_SPEAKERS) {
      for (const lang of ["tr", "en"] as const) {
        const words = s.script[lang].split(/\s+/).length;
        // About 30 to 45 seconds spoken, so the loop is not obvious.
        expect(words).toBeGreaterThan(60);
        expect(words).toBeLessThan(130);
      }
    }
  });
});

describe("the tail of a looping recording", () => {
  const rec = Float32Array.from({ length: 10 }, (_, i) => i);

  it("takes the latest samples within the first pass", () => {
    expect([...loopTail(rec, 7, 3)]).toEqual([4, 5, 6]);
  });

  it("wraps around the loop", () => {
    expect([...loopTail(rec, 23, 5)]).toEqual([8, 9, 0, 1, 2]);
  });

  it("never returns more than was played or than the recording holds", () => {
    expect([...loopTail(rec, 2, 5)]).toEqual([0, 1]);
    expect(loopTail(rec, 100, 50).length).toBe(10);
  });
});

describe("splitting a script for parallel synthesis", () => {
  it("keeps every word, in order, at sentence ends, in about the asked number of pieces", () => {
    for (const s of FOCUS_SPEAKERS) {
      for (const lang of ["tr", "en"] as const) {
        const pieces = splitScript(s.script[lang], 4);
        expect(pieces.length).toBeGreaterThanOrEqual(3);
        expect(pieces.length).toBeLessThanOrEqual(4);
        expect(pieces.join(" ")).toBe(s.script[lang]);
        for (const p of pieces.slice(0, -1)) expect(p).toMatch(/[.!?]$/);
      }
    }
  });
});

describe("starting a recap after a pause", () => {
  const rate = 1000;
  // Speech (a tone) with a quiet gap from 2.0 s to 2.4 s, in a 6 s loop.
  const rec = Float32Array.from({ length: 6000 }, (_, i) => (i >= 2000 && i < 2400 ? 0 : 0.3 * Math.sin(i)));

  it("moves a start that falls mid-word back to just after the pause", () => {
    const start = startAfterPause(rec, 3000, rate);
    expect(start).toBeGreaterThanOrEqual(2380);
    expect(start).toBeLessThanOrEqual(2420);
  });

  it("keeps the start when there is no pause within reach, or none before the earliest point", () => {
    expect(startAfterPause(rec, 3000, rate, { maxBackSec: 0.5 })).toBe(3000);
    expect(startAfterPause(rec, 3000, rate, { earliest: 2700 })).toBe(3000);
  });

  it("works across the loop's end", () => {
    const start = startAfterPause(rec, 6000 + 3000, rate);
    expect(start - 6000).toBeGreaterThanOrEqual(2380);
    expect(start - 6000).toBeLessThanOrEqual(2420);
  });
});
