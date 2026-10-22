import { describe, expect, it } from "vitest";
import { highPass, hpfGate, spectralGate } from "@/lib/audio/denoise";
import { PHRASES, phrasesFor, quickSet } from "@/lib/shared/lab/phrases";
import { normalizeTranscript } from "@/lib/shared/text/normalize";
import { scoreTranscript } from "@/lib/shared/text/wer";
import { seededRandom } from "@/lib/shared/stats";

const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
};
const db = (ratio: number) => 20 * Math.log10(ratio);
const sine = (f: number, rate: number, sec: number, amp = 0.3) =>
  Float32Array.from({ length: Math.round(rate * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / rate));

describe("phrase sets", () => {
  it("has 30 phrases per language with unique ids", () => {
    expect(phrasesFor("en")).toHaveLength(30);
    expect(phrasesFor("tr")).toHaveLength(30);
    expect(new Set(PHRASES.map((p) => p.id)).size).toBe(60);
    for (const p of PHRASES) expect(p.id.startsWith(p.lang)).toBe(true);
  });

  it("mixes commands, sentences, numbers and names", () => {
    for (const lang of ["en", "tr"] as const) {
      const set = phrasesFor(lang);
      expect(set.filter((p) => p.kind === "command").length).toBeGreaterThanOrEqual(10);
      expect(set.filter((p) => p.kind === "sentence").length).toBeGreaterThanOrEqual(8);
      expect(set.filter((p) => p.tags.includes("number")).length).toBeGreaterThanOrEqual(6);
      expect(set.filter((p) => p.tags.includes("name")).length).toBeGreaterThanOrEqual(8);
    }
  });

  it("quick sets have ten phrases and keep the Turkish edge cases", () => {
    expect(quickSet("en")).toHaveLength(10);
    const tr = quickSet("tr");
    expect(tr).toHaveLength(10);
    expect(tr.map((p) => p.id)).toEqual(expect.arrayContaining(["tr-02", "tr-03", "tr-30"]));
  });

  it("every phrase scores zero against itself, reformatted", () => {
    for (const p of PHRASES) {
      const plain = p.text.toLocaleUpperCase(p.lang === "tr" ? "tr-TR" : "en-US").replace(/[.,?!]/g, "");
      const s = scoreTranscript(p.text, plain, p.lang);
      expect(s.wer, p.id).toBe(0);
      expect(normalizeTranscript(p.text, p.lang).length, p.id).toBeGreaterThan(0);
    }
  });

  it("normalizes the dotless I phrase in Turkish", () => {
    const p = PHRASES.find((x) => x.id === "tr-30")!;
    expect(normalizeTranscript(p.text, "tr")[0]).toBe("ışıkları");
    expect(scoreTranscript(p.text, "isiklari kapat ve kapiyi kilitle", "tr").wer).toBeGreaterThan(0);
  });
});

describe("high-pass filter", () => {
  it("cuts 50 Hz by about 12 dB and leaves 1 kHz alone", () => {
    const low = highPass(sine(50, 16000, 1), 16000, 100);
    const mid = highPass(sine(1000, 16000, 1), 16000, 100);
    expect(db(rms(low, 4000) / rms(sine(50, 16000, 1), 4000))).toBeLessThan(-10);
    expect(Math.abs(db(rms(mid, 4000) / rms(sine(1000, 16000, 1), 4000)))).toBeLessThan(0.2);
  });
});

describe("spectral gate", () => {
  const noise = (sec: number, amp: number, seed = 3) => {
    const r = seededRandom(seed);
    return Float32Array.from({ length: 16000 * sec }, () => (r() * 2 - 1) * amp);
  };

  it("reconstructs the input exactly when nothing is gated", () => {
    const x = sine(440, 16000, 0.5);
    const y = spectralGate(x, { propDecrease: 0 });
    expect(y.length).toBe(x.length);
    let maxErr = 0;
    for (let i = 0; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(x[i]! - y[i]!));
    expect(maxErr).toBeLessThan(1e-4);
  });

  it("removes steady noise between words and keeps the words", () => {
    // 1 s noise, 1 s tone plus noise, 1 s noise.
    const n = noise(3, 0.02);
    const tone = sine(700, 16000, 1, 0.2);
    const x = n.slice();
    for (let i = 0; i < tone.length; i++) x[16000 + i]! += tone[i]!;
    const y = hpfGate(x);
    const gapBefore = rms(x, 2000, 14000);
    const gapAfter = rms(y, 2000, 14000);
    expect(db(gapAfter / gapBefore)).toBeLessThan(-12);
    const toneBefore = rms(x, 18000, 30000);
    const toneAfter = rms(y, 18000, 30000);
    expect(Math.abs(db(toneAfter / toneBefore))).toBeLessThan(2);
  });

  it("leaves clean speech alone instead of gating it against itself", () => {
    // Tone bursts in digital silence: the quietest non-silent frames are the
    // bursts' own edges, which must not be mistaken for noise.
    const x = new Float32Array(16000 * 3);
    for (const start of [4000, 20000, 36000]) {
      const burst = sine(500, 16000, 0.5, 0.2);
      for (let i = 0; i < burst.length; i++) {
        const env = Math.min(1, i / 400, (burst.length - i) / 400);
        x[start + i] = burst[i]! * env;
      }
    }
    const y = hpfGate(x);
    expect(Math.abs(db(rms(y) / rms(x)))).toBeLessThan(0.5);
  });

  it("passes short input through", () => {
    expect(spectralGate(new Float32Array(100)).length).toBe(100);
  });
});
