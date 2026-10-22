import { powerSpectrum } from "./fft";

/**
 * Measurements for the setup wizard and the lab. Pure functions over sample
 * arrays, so they run the same in the browser and in tests.
 */

export const ANALYSIS_FFT = 2048;
const FRAME_MS = 20;
/** Digital silence reads as this, not as -Infinity or -600 dB of rounding noise. */
export const SILENCE_DB = -120;

const db = (power: number) => (power > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(power)) : SILENCE_DB);

/**
 * Power spectrum bins to dB relative to a full scale sine: a Hann windowed
 * full scale sine peaks at (n/4)^2 in powerSpectrum's units.
 */
export function spectrumToDbfs(power: Float64Array, n: number): Float32Array {
  const ref = 20 * Math.log10(n / 4);
  return Float32Array.from(power, (p) => (p > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(p) - ref) : SILENCE_DB));
}

/** RMS level of consecutive short frames, in dBFS. */
export function frameLevels(samples: Float32Array, sampleRate: number, frameMs = FRAME_MS): number[] {
  const n = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const out: number[] = [];
  for (let start = 0; start + n <= samples.length; start += n) {
    let sum = 0;
    for (let i = start; i < start + n; i++) sum += samples[i]! * samples[i]!;
    out.push(db(sum / n));
  }
  return out;
}

function percentileOf(values: number[], p: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return SILENCE_DB;
  return v[Math.min(v.length - 1, Math.max(0, Math.round((p / 100) * (v.length - 1))))]!;
}

function bandEnergy(power: Float64Array, sampleRate: number, n: number, lo: number, hi: number): number {
  const binHz = sampleRate / n;
  let sum = 0;
  for (let k = Math.max(1, Math.ceil(lo / binHz)); k <= Math.min(power.length - 1, Math.floor(hi / binHz)); k++) {
    sum += power[k]!;
  }
  return sum;
}

/**
 * The highest of a few standard edges that the signal actually reaches.
 * Bluetooth hands-free audio is band limited at 4 kHz (narrow band) or 8 kHz
 * (wide band) even when the browser resamples it to 48 kHz, so the reported
 * sample rate alone can hide it. A band counts as empty when it holds less
 * than a millionth of the energy of the 300 to 3000 Hz speech band. Each
 * test band starts 1 kHz above its edge: the resampler that turned 8 or
 * 16 kHz audio into 48 kHz leaks a little just above the edge.
 */
const EDGES = [4000, 8000, 12000, 16000];
const EMPTY_BAND_DB = -60;
const GUARD_HZ = 1000;

export function effectiveBandwidth(avgPower: Float64Array, sampleRate: number, n = ANALYSIS_FFT): number | null {
  const nyquist = sampleRate / 2;
  const ref = bandEnergy(avgPower, sampleRate, n, 300, 3000);
  if (!(ref > 0)) return null;
  for (const edge of EDGES) {
    if (edge + GUARD_HZ >= nyquist) return Math.floor(nyquist / 1000) * 1000;
    const above = bandEnergy(avgPower, sampleRate, n, edge + GUARD_HZ, Math.min(edge + GUARD_HZ + 2500, nyquist));
    if (db(above / ref) < EMPTY_BAND_DB) return edge;
  }
  return Math.min(20000, Math.floor(nyquist / 1000) * 1000);
}

/** Share of energy between minHz and cutoffHz, relative to everything above minHz. */
export function lowFrequencyRatio(power: Float64Array, sampleRate: number, n = ANALYSIS_FFT, cutoffHz = 200, minHz = 20): number {
  const low = bandEnergy(power, sampleRate, n, minHz, cutoffHz);
  const total = bandEnergy(power, sampleRate, n, minHz, sampleRate / 2);
  return total > 0 ? low / total : 0;
}

export interface MicCheckResult {
  /** Typical level while speaking (median of the louder frames). */
  speechDbfs: number;
  peakDbfs: number;
  noiseFloorDbfs: number;
  clippedSamples: number;
  speechFrames: number;
  totalFrames: number;
  effectiveBandwidthHz: number | null;
  /** Average spectrum over speech frames, in dB, bins 0..n/2 (for display). */
  spectrumDb: Float32Array;
}

export function analyzeMicCheck(samples: Float32Array, sampleRate: number): MicCheckResult {
  const levels = frameLevels(samples, sampleRate);
  const noiseFloor = percentileOf(levels, 10);
  const speechThreshold = Math.max(noiseFloor + 10, -50);
  const frameLen = Math.round((sampleRate * FRAME_MS) / 1000);

  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
    if (a >= 0.99) clipped++;
  }

  // Spectrum over windows that start in speech frames.
  const n = ANALYSIS_FFT;
  const avg = new Float64Array(n / 2 + 1);
  let count = 0;
  const speechLevels: number[] = [];
  for (let f = 0; f < levels.length; f++) {
    if (levels[f]! < speechThreshold) continue;
    speechLevels.push(levels[f]!);
    const start = f * frameLen;
    if (f % 2 === 0 && start + n <= samples.length) {
      const p = powerSpectrum(samples.subarray(start, start + n), n);
      for (let k = 0; k < p.length; k++) avg[k]! += p[k]!;
      count++;
    }
  }
  if (count) for (let k = 0; k < avg.length; k++) avg[k] = avg[k]! / count;

  return {
    speechDbfs: speechLevels.length ? percentileOf(speechLevels, 50) : -Infinity,
    peakDbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    noiseFloorDbfs: noiseFloor,
    clippedSamples: clipped,
    speechFrames: speechLevels.length,
    totalFrames: levels.length,
    effectiveBandwidthHz: count ? effectiveBandwidth(avg, sampleRate, n) : null,
    spectrumDb: spectrumToDbfs(avg, n),
  };
}

/** Speech level minus noise floor, from one recording. */
export function estimateSnrDb(samples: Float32Array, sampleRate: number): number | null {
  const levels = frameLevels(samples, sampleRate);
  if (levels.length < 5) return null;
  const floor = percentileOf(levels, 10);
  const loud = percentileOf(levels, 90);
  return Number.isFinite(floor) && Number.isFinite(loud) ? loud - floor : null;
}

/**
 * Streaming low frequency meter for the wind test: feed it samples as they
 * arrive, read the latest, average and highest share of energy below 200 Hz.
 * Frames quieter than -65 dBFS are ignored so silence does not drag the
 * average around.
 */
export class LowFrequencyMeter {
  private buf = new Float32Array(0);
  private sum = 0;
  private frames = 0;
  latest = 0;
  highest = 0;
  lastSpectrumDb: Float32Array | null = null;

  constructor(
    readonly sampleRate: number,
    readonly n = ANALYSIS_FFT,
  ) {}

  /** Frames of n samples with 50% overlap. */
  push(samples: Float32Array) {
    const merged = new Float32Array(this.buf.length + samples.length);
    merged.set(this.buf);
    merged.set(samples, this.buf.length);
    this.buf = merged;
    while (this.buf.length >= this.n) {
      this.analyze(this.buf.subarray(0, this.n));
      this.buf = this.buf.slice(this.n / 2);
    }
  }

  private analyze(frame: Float32Array) {
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i]! * frame[i]!;
    const p = powerSpectrum(frame, this.n);
    this.lastSpectrumDb = spectrumToDbfs(p, this.n);
    if (db(energy / frame.length) < -65) return;
    this.latest = lowFrequencyRatio(p, this.sampleRate, this.n);
    this.highest = Math.max(this.highest, this.latest);
    this.sum += this.latest;
    this.frames++;
  }

  get average(): number | null {
    return this.frames ? this.sum / this.frames : null;
  }
}
