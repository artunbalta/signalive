import { fft, ifft } from "./fft";

/**
 * Chain (d): high-pass filter, then spectral gating. Pure TypeScript, offline,
 * deterministic, so every browser produces the same output for the same take.
 *
 * Spectral gating, in the spirit of the "noisereduce" method: estimate a
 * per-frequency noise threshold from the quietest frames of the take
 * (mean + 1.5 standard deviations of their dB magnitudes), keep bins above
 * it, attenuate bins below it, and smooth the mask over time and frequency so
 * the result does not warble. 512 point STFT at 16 kHz (32 ms), 75% overlap,
 * Hann windows normalized so analysis and synthesis reconstruct exactly.
 */

/** RBJ cookbook second order high-pass, applied in place, Direct Form I. */
export function highPass(samples: Float32Array, sampleRate: number, cutoffHz = 100, q = Math.SQRT1_2): Float32Array {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = (1 + cos) / 2 / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

export interface GateOptions {
  n: number;
  hop: number;
  /** Threshold = mean + nStd * std of the noise frames' dB magnitude. */
  nStd: number;
  /** Share of frames, the quietest, used as the noise sample. */
  noiseShare: number;
  /** 1 removes gated bins entirely; lower keeps some floor. */
  propDecrease: number;
  /** Mask smoothing: bins either side in frequency and frames either side in time. */
  smoothFreq: number;
  smoothTime: number;
}

/** Loudest minus quietest frames, in dB, above which a take counts as clean. */
const CLEAN_SPREAD_DB = 35;

export const GATE_DEFAULTS: GateOptions = {
  n: 512,
  hop: 128,
  nStd: 1.5,
  noiseShare: 0.15,
  propDecrease: 0.9,
  smoothFreq: 2,
  smoothTime: 2,
};

export function spectralGate(samples: Float32Array, opts: Partial<GateOptions> = {}): Float32Array {
  const o = { ...GATE_DEFAULTS, ...opts };
  const { n, hop } = o;
  const bins = n / 2 + 1;
  if (samples.length < n) return samples.slice();

  // Hann window scaled so that window^2 summed at this overlap is 1.
  const win = new Float64Array(n);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    sumSq += win[i]! * win[i]!;
  }
  const norm = Math.sqrt(hop / sumSq);
  for (let i = 0; i < n; i++) win[i] = win[i]! * norm;

  // Pad so every sample is covered by full overlap.
  const padded = new Float32Array(samples.length + 2 * n);
  padded.set(samples, n);
  const frames = Math.floor((padded.length - n) / hop) + 1;

  const re: Float64Array[] = [];
  const im: Float64Array[] = [];
  const magDb: Float64Array[] = [];
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const r = new Float64Array(n);
    const m = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = padded[f * hop + i]! * win[i]!;
    fft(r, m);
    const d = new Float64Array(bins);
    let e = 0;
    for (let k = 0; k < bins; k++) {
      const p = r[k]! * r[k]! + m[k]! * m[k]!;
      d[k] = 10 * Math.log10(p + 1e-20);
      e += p;
    }
    re.push(r);
    im.push(m);
    magDb.push(d);
    energy[f] = e;
  }

  // Noise statistics from the quietest frames that are not digital silence.
  const order = [...energy.keys()].filter((f) => energy[f]! > 1e-14).sort((a, b) => energy[a]! - energy[b]!);
  const noiseFrames = order.slice(0, Math.max(3, Math.floor(order.length * o.noiseShare)));

  // In a clean recording the quietest frames are quiet speech, not noise, and
  // gating against them would remove speech. With more than CLEAN_SPREAD_DB
  // between the quietest and the loudest frames there is no noise worth
  // removing, so the signal passes through.
  const meanDb = (frames: number[]) =>
    frames.reduce((acc, f) => acc + 10 * Math.log10(energy[f]! + 1e-20), 0) / Math.max(1, frames.length);
  const loudFrames = order.slice(Math.floor(order.length * 0.8));
  if (order.length < 10 || meanDb(loudFrames) - meanDb(noiseFrames) > CLEAN_SPREAD_DB) return samples.slice();
  const thresh = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    let mean = 0;
    for (const f of noiseFrames) mean += magDb[f]![k]!;
    mean /= noiseFrames.length || 1;
    let v = 0;
    for (const f of noiseFrames) v += (magDb[f]![k]! - mean) ** 2;
    const std = Math.sqrt(v / (noiseFrames.length || 1));
    thresh[k] = mean + o.nStd * std;
  }

  // Binary mask, then smoothed.
  const mask: Float64Array[] = magDb.map((d) => Float64Array.from(d, (v, k) => (v > thresh[k]! ? 1 : 0)));
  const smooth: Float64Array[] = [];
  for (let f = 0; f < frames; f++) {
    const row = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      let s = 0;
      let c = 0;
      for (let df = -o.smoothTime; df <= o.smoothTime; df++) {
        const ff = f + df;
        if (ff < 0 || ff >= frames) continue;
        for (let dk = -o.smoothFreq; dk <= o.smoothFreq; dk++) {
          const kk = k + dk;
          if (kk < 0 || kk >= bins) continue;
          s += mask[ff]![kk]!;
          c++;
        }
      }
      row[k] = s / c;
    }
    smooth.push(row);
  }

  // Apply, inverse transform, overlap-add with the same window.
  const out = new Float64Array(padded.length);
  for (let f = 0; f < frames; f++) {
    const r = re[f]!;
    const m = im[f]!;
    for (let k = 0; k < bins; k++) {
      const gain = 1 - o.propDecrease * (1 - smooth[f]![k]!);
      r[k] = r[k]! * gain;
      m[k] = m[k]! * gain;
      if (k > 0 && k < n / 2) {
        r[n - k] = r[n - k]! * gain;
        m[n - k] = m[n - k]! * gain;
      }
    }
    ifft(r, m);
    for (let i = 0; i < n; i++) out[f * hop + i]! += r[i]! * win[i]!;
  }
  return Float32Array.from(out.subarray(n, n + samples.length));
}

/** The whole chain (d): 100 Hz high-pass, then the gate. */
export function hpfGate(samples16k: Float32Array): Float32Array {
  return spectralGate(highPass(samples16k, 16000, 100));
}
