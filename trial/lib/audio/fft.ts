/**
 * Iterative radix-2 FFT. Pure TypeScript so the same code analyses audio in
 * the browser and in unit tests.
 */

const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function plan(n: number) {
  let p = twiddles.get(n);
  if (p) return p;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error("FFT size must be a power of two");
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  p = { cos, sin, rev };
  twiddles.set(n, p);
  return p;
}

/** In place complex FFT of (re, im). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!;
        const wi = sin[k * step]!;
        const a = start + k;
        const b = a + half;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

/** Inverse FFT, in place, scaled by 1/n. */
export function ifft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < im.length; i++) im[i] = -im[i]!;
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] = re[i]! / n;
    im[i] = -im[i]! / n;
  }
}

const windows = new Map<number, Float64Array>();

/** Periodic Hann window, cached per size. */
export function hann(n: number): Float64Array {
  let w = windows.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    windows.set(n, w);
  }
  return w;
}

/**
 * Power spectrum (bins 0..n/2) of one frame, Hann windowed. Values are
 * linear power; frames shorter than n are zero padded.
 */
export function powerSpectrum(frame: ArrayLike<number>, n: number): Float64Array {
  const w = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const len = Math.min(n, frame.length);
  for (let i = 0; i < len; i++) re[i] = frame[i]! * w[i]!;
  fft(re, im);
  const out = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) out[k] = re[k]! * re[k]! + im[k]! * im[k]!;
  return out;
}
