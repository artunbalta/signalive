import { describe, expect, it } from "vitest";
import { VAD_NORMAL, VadSegmenter, type VadEvent } from "@/lib/audio/vad-segmenter";

const FRAME = 512;

/** Feeds a probability per frame; each frame's samples carry its index. */
function run(seg: VadSegmenter, probs: number[]) {
  const events: (VadEvent & { frame: number })[] = [];
  probs.forEach((p, i) => {
    const frame = new Float32Array(FRAME).fill(i);
    for (const e of seg.push(frame, p, (i + 1) * 32)) events.push({ ...e, frame: i });
  });
  return events;
}

const rep = (p: number, n: number) => Array<number>(n).fill(p);

describe("VadSegmenter", () => {
  it("finds one utterance with pre-roll, confirmation and end", () => {
    const seg = new VadSegmenter();
    const probs = [...rep(0.05, 20), ...rep(0.9, 20), ...rep(0.05, 30)];
    const ev = run(seg, probs);
    expect(ev.map((e) => e.type)).toEqual(["start", "confirmed", "end"]);
    const start = ev[0] as Extract<VadEvent, { type: "start" }> & { frame: number };
    expect(start.frame).toBe(20);
    // 320 ms of pad = 10 frames of 32 ms.
    expect(start.preroll.length).toBe(10 * FRAME);
    const end = ev[2] as Extract<VadEvent, { type: "end" }> & { frame: number };
    // 600 ms redemption = 19 frames after the last speech frame (index 39).
    expect(end.frame).toBe(39 + 19);
    expect(end.lastSpeechAt).toBe(40 * 32);
    expect(end.speechMs).toBe(20 * 32);
    // The audio holds the pad, the speech and the redemption tail.
    expect(end.audio.length).toBe((10 + 20 + 19) * FRAME);
    expect(end.audio[0]).toBe(10); // first padded frame is index 10
  });

  it("ignores short blips as misfires", () => {
    const ev = run(new VadSegmenter(), [...rep(0.05, 5), ...rep(0.9, 3), ...rep(0.05, 30)]);
    expect(ev.map((e) => e.type)).toEqual(["start", "misfire"]);
  });

  it("bridges pauses shorter than the redemption time", () => {
    const probs = [...rep(0.9, 15), ...rep(0.1, 10), ...rep(0.9, 15), ...rep(0.05, 25)];
    const ev = run(new VadSegmenter(), probs);
    expect(ev.filter((e) => e.type === "end")).toHaveLength(1);
  });

  it("uses hysteresis: frames between the thresholds do not end speech", () => {
    const probs = [...rep(0.9, 12), ...rep(0.4, 40), ...rep(0.05, 25)];
    const ev = run(new VadSegmenter(), probs);
    const end = ev.find((e) => e.type === "end")!;
    expect(end.frame).toBe(12 + 40 + 18);
  });

  it("cuts very long speech at the maximum and keeps going", () => {
    const seg = new VadSegmenter({ ...VAD_NORMAL, maxSpeechMs: 3200 });
    const ev = run(seg, [...rep(0.9, 250), ...rep(0.05, 30)]);
    const ends = ev.filter((e) => e.type === "end") as Extract<VadEvent, { type: "end" }>[];
    expect(ends.length).toBeGreaterThanOrEqual(2);
    expect(ends[0]!.forced).toBe(true);
    expect(ends.at(-1)!.forced).toBe(false);
  });

  it("is more sensitive with whisper thresholds", () => {
    const quiet = [...rep(0.05, 10), ...rep(0.35, 20), ...rep(0.05, 30)];
    expect(run(new VadSegmenter(), quiet).some((e) => e.type === "end")).toBe(false);
    const seg = new VadSegmenter();
    seg.setOptions({ positiveThreshold: 0.3, negativeThreshold: 0.2 });
    expect(run(seg, quiet).some((e) => e.type === "end")).toBe(true);
  });
});
