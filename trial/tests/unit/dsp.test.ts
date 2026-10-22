import { describe, expect, it } from "vitest";
import { fft, ifft, powerSpectrum } from "@/lib/audio/fft";
import { resample, StreamingResampler } from "@/lib/audio/resample";
import {
  analyzeMicCheck,
  effectiveBandwidth,
  estimateSnrDb,
  LowFrequencyMeter,
  lowFrequencyRatio,
  ANALYSIS_FFT,
} from "@/lib/audio/analysis";
import { decodeWav, encodeWav, floatToInt16, int16ToFloat, rmsDbfs } from "@/lib/shared/audio/wav";
import { seededRandom } from "@/lib/shared/stats";

const sine = (freq: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (to - from));
};

/** Speech-like noise: random bursts with pauses, white within the band. */
function babble(rate: number, seconds: number, seed = 7): Float32Array {
  const rand = seededRandom(seed);
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const envelope = Math.sin(Math.PI * ((t * 3) % 1)) > 0.3 ? 0.3 : 0.002;
    out[i] = (rand() * 2 - 1) * envelope;
  }
  return out;
}

describe("fft", () => {
  it("round trips", () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + i * 0.01);
    const im = new Float64Array(64);
    const orig = re.slice();
    fft(re, im);
    ifft(re, im);
    for (let i = 0; i < 64; i++) expect(re[i]).toBeCloseTo(orig[i]!, 9);
  });

  it("puts a sine in the right bin", () => {
    const rate = 48000;
    const n = 2048;
    const binHz = rate / n;
    const p = powerSpectrum(sine(binHz * 100, rate, 0.1), n);
    let best = 0;
    for (let k = 1; k < p.length; k++) if (p[k]! > p[best]!) best = k;
    expect(best).toBe(100);
  });

  it("rejects sizes that are not powers of two", () => {
    expect(() => fft(new Float64Array(100), new Float64Array(100))).toThrow();
  });
});

describe("resampler", () => {
  it("keeps a 1 kHz tone at 48k to 16k", () => {
    const out = resample(sine(1000, 48000, 1), 48000, 16000);
    expect(out.length).toBe(16000);
    // Skip the edges, where the window sees the implicit zeros.
    expect(rms(out, 200, 15800)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    let crossings = 0;
    for (let i = 201; i < 15800; i++) if (out[i - 1]! < 0 && out[i]! >= 0) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(974);
    expect(crossings).toBeLessThanOrEqual(976);
  });

  it("removes content above the new Nyquist frequency", () => {
    const out = resample(sine(12000, 48000, 1), 48000, 16000);
    const level = 20 * Math.log10(rms(out, 200, 15800) / (0.5 / Math.SQRT2));
    expect(level).toBeLessThan(-50);
  });

  it("handles 44.1 kHz input", () => {
    const out = resample(sine(440, 44100, 1), 44100, 16000);
    expect(out.length).toBe(16000);
    expect(rms(out, 200, 15800)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("gives the same result in chunks as in one piece", () => {
    const input = babble(48000, 0.5);
    const whole = resample(input, 48000, 16000);
    const r = new StreamingResampler(48000, 16000);
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 1000) parts.push(...r.process(input.subarray(i, i + 1000)));
    parts.push(...r.flush());
    for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i]!, 6);
  });

  it("upsamples without changing the level", () => {
    const out = resample(sine(500, 16000, 1), 16000, 48000);
    expect(out.length).toBe(48000);
    expect(rms(out, 600, 47400)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });
});

describe("mic check analysis", () => {
  it("finds a full band microphone", () => {
    const res = analyzeMicCheck(babble(48000, 5), 48000);
    expect(res.effectiveBandwidthHz).toBeGreaterThanOrEqual(16000);
    expect(res.speechFrames).toBeGreaterThan(50);
    expect(res.speechDbfs).toBeGreaterThan(res.noiseFloorDbfs + 20);
  });

  it("spots narrow band and wide band hands-free audio behind a 48 kHz rate", () => {
    // What a browser hands over for Bluetooth HFP: 8 or 16 kHz audio upsampled to 48 kHz.
    const narrow = resample(resample(babble(48000, 5), 48000, 8000), 8000, 48000);
    expect(analyzeMicCheck(narrow, 48000).effectiveBandwidthHz).toBe(4000);
    const wide = resample(resample(babble(48000, 5), 48000, 16000), 16000, 48000);
    expect(analyzeMicCheck(wide, 48000).effectiveBandwidthHz).toBe(8000);
  });

  it("reports silence as unmeasurable rather than narrow", () => {
    const res = analyzeMicCheck(new Float32Array(48000 * 5), 48000);
    expect(res.effectiveBandwidthHz).toBeNull();
    expect(res.speechFrames).toBe(0);
  });

  it("counts clipping and measures the peak", () => {
    const loud = sine(300, 48000, 1, 1.2).map((x) => Math.max(-1, Math.min(1, x)));
    const res = analyzeMicCheck(loud, 48000);
    expect(res.clippedSamples).toBeGreaterThan(1000);
    expect(res.peakDbfs).toBeCloseTo(0, 1);
  });

  it("estimates SNR from bursts and pauses", () => {
    const snr = estimateSnrDb(babble(48000, 3), 48000)!;
    expect(snr).toBeGreaterThan(30);
  });

  it("caps bandwidth at the Nyquist frequency of a 16 kHz context", () => {
    const p = powerSpectrum(babble(16000, 0.2), ANALYSIS_FFT);
    expect(effectiveBandwidth(p, 16000)).toBe(8000);
  });
});

describe("wind measure", () => {
  it("is near 1 for a 100 Hz rumble and near 0 for a 1 kHz tone", () => {
    expect(lowFrequencyRatio(powerSpectrum(sine(100, 48000, 0.05), ANALYSIS_FFT), 48000)).toBeGreaterThan(0.95);
    expect(lowFrequencyRatio(powerSpectrum(sine(1000, 48000, 0.05), ANALYSIS_FFT), 48000)).toBeLessThan(0.01);
  });

  it("streams, ignoring silence", () => {
    const m = new LowFrequencyMeter(48000);
    m.push(new Float32Array(48000));
    expect(m.average).toBeNull();
    const rumble = sine(80, 48000, 1, 0.3);
    for (let i = 0; i < rumble.length; i += 960) m.push(rumble.subarray(i, i + 960));
    expect(m.average!).toBeGreaterThan(0.9);
    expect(m.highest).toBeGreaterThanOrEqual(m.average!);
  });
});

describe("wav", () => {
  it("round trips 16 bit PCM", () => {
    const x = sine(440, 16000, 0.25, 0.8);
    const decoded = decodeWav(encodeWav(x, 16000));
    expect(decoded.sampleRate).toBe(16000);
    expect(decoded.samples.length).toBe(x.length);
    for (let i = 0; i < x.length; i += 97) expect(decoded.samples[i]).toBeCloseTo(x[i]!, 3);
    expect(decoded.durationMs).toBeCloseTo(250, 5);
  });

  it("clamps and converts", () => {
    const i16 = floatToInt16(Float32Array.from([2, -2, 0, 0.5]));
    expect(Array.from(i16)).toEqual([32767, -32768, 0, 16384]);
    expect(int16ToFloat(i16)[1]).toBe(-1);
  });

  it("rejects non WAV input and measures levels", () => {
    expect(() => decodeWav(new Uint8Array(100))).toThrow();
    expect(rmsDbfs(new Float32Array(10))).toBe(-Infinity);
    expect(rmsDbfs(sine(1000, 48000, 0.1, 1))).toBeCloseTo(-3.01, 1);
  });
});
