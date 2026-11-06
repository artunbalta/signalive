/**
 * The front of the earbud signal chain: Butterworth band pass design, second
 * order section filtering and linear resampling, ported from the reference
 * chain in research/aad/pipeline.py.
 *
 * The design reproduces scipy.signal.butter(..., output="sos") step by step
 * (prototype, prewarp, band pass transform, bilinear transform, SciPy's own
 * pole and zero pairing) so a model trained in Python runs here on the same
 * coefficients, in the same section order, with the gain in the same place.
 * The filter and the resampler are the streaming forms of sosfilt and of
 * pipeline.decimate: one sample in, the same numbers out.
 */

/** One second order section: b0, b1, b2, a0, a1, a2, with a0 = 1. */
export type Section = [number, number, number, number, number, number];
export type Sos = Section[];

/* ---- Complex arithmetic, design time only ------------------------------- */

/** A complex number. Only the filter design uses these, never a sample loop. */
interface Cx {
  re: number;
  im: number;
}

const cx = (re: number, im = 0): Cx => ({ re, im });
const cadd = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im);
const csub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im);
const cmul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cabs = (a: Cx): number => Math.hypot(a.re, a.im);

/** Complex division the way NumPy does it (Smith's method), so rounding matches. */
function cdiv(a: Cx, b: Cx): Cx {
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const rat = b.im / b.re;
    const scl = 1 / (b.re + b.im * rat);
    return cx((a.re + a.im * rat) * scl, (a.im - a.re * rat) * scl);
  }
  const rat = b.re / b.im;
  const scl = 1 / (b.im + b.re * rat);
  return cx((a.re * rat + a.im) * scl, (a.im * rat - a.re) * scl);
}

/** Principal square root, branch cut on the negative real axis like C99 csqrt. */
function csqrt(a: Cx): Cx {
  if (a.re === 0 && a.im === 0) return cx(0, a.im);
  const m = cabs(a);
  if (a.re >= 0) {
    const t = Math.sqrt((m + a.re) / 2);
    return cx(t, a.im / (2 * t));
  }
  const t = Math.sqrt((m - a.re) / 2);
  const negative = a.im < 0 || Object.is(a.im, -0);
  return cx(Math.abs(a.im) / (2 * t), negative ? -t : t);
}

/* ---- Butterworth band pass ---------------------------------------------- */

/**
 * Splits roots into one representative per conjugate pair (positive imaginary
 * part, sorted by real part then imaginary magnitude) and the real ones,
 * sorted, exactly like SciPy's _cplxreal. The order decides ties later on.
 */
function cplxreal(z: Cx[]): { pairs: Cx[]; reals: number[] } {
  const tol = 100 * Number.EPSILON;
  const sorted = z.slice().sort((a, b) => a.re - b.re || Math.abs(a.im) - Math.abs(b.im));
  const isReal = (c: Cx) => Math.abs(c.im) <= tol * cabs(c);
  const reals = sorted.filter(isReal).map((c) => c.re);
  const rest = sorted.filter((c) => !isReal(c));
  const zp = rest.filter((c) => c.im > 0);
  const zn = rest.filter((c) => c.im < 0);
  if (zp.length !== zn.length) throw new Error("dsp: a complex root has no conjugate");
  // Runs of (nearly) equal real part are ordered by imaginary magnitude.
  let i = 0;
  while (i < zp.length - 1) {
    let j = i;
    while (j < zp.length - 1 && zp[j + 1].re - zp[j].re <= tol * cabs(zp[j])) j++;
    if (j > i) {
      const byImag = (a: Cx, b: Cx) => Math.abs(a.im) - Math.abs(b.im);
      zp.splice(i, j - i + 1, ...zp.slice(i, j + 1).sort(byImag));
      zn.splice(i, j - i + 1, ...zn.slice(i, j + 1).sort(byImag));
    }
    i = j + 1;
  }
  const pairs = zp.map((p, k) => {
    const n = zn[k];
    if (Math.hypot(p.re - n.re, p.im + n.im) > tol * cabs(n)) {
      throw new Error("dsp: a complex root has no conjugate");
    }
    return cx((p.re + n.re) / 2, (p.im - n.im) / 2);
  });
  return { pairs, reals };
}

/** Index of the root closest to the unit circle, first one on ties (np.argmin). */
function worst(p: Cx[], only?: (c: Cx) => boolean): number {
  let best = -1;
  let dist = Infinity;
  for (let i = 0; i < p.length; i++) {
    if (only && !only(p[i])) continue;
    const d = Math.abs(1 - cabs(p[i]));
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

/** Index of the real zero nearest to p, first one on ties. */
function nearest(z: number[], p: Cx): number {
  let best = -1;
  let dist = Infinity;
  for (let i = 0; i < z.length; i++) {
    const d = Math.hypot(z[i] - p.re, p.im);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

/** Monic polynomial from up to two real roots, right aligned in three slots. */
function polyReal(roots: number[]): [number, number, number] {
  if (roots.length === 0) return [0, 0, 1];
  if (roots.length === 1) return [0, 1, -roots[0]];
  return [1, -(roots[0] + roots[1]), roots[0] * roots[1]];
}

/** Monic polynomial from up to two poles (a conjugate pair or reals), right aligned. */
function polyPoles(roots: Cx[]): [number, number, number] {
  if (roots.length === 1) return [0, 1, -roots[0].re];
  const [p1, p2] = roots;
  return [1, -(p1.re + p2.re), p1.re * p2.re - p1.im * p2.im];
}

/**
 * Second order sections from digital zeros, poles and gain with SciPy's
 * "nearest" pairing: the pole closest to the unit circle goes last, with the
 * zeros nearest to it, and the overall gain multiplies the first section.
 * Zeros must be real, which holds for every Butterworth design.
 */
function zpk2sos(zeros: number[], poles: Cx[], k: number): Sos {
  let z = zeros.slice();
  let p = poles.slice();
  // Equal counts, and an even number of poles, by adding roots at the origin.
  while (p.length < z.length) p.push(cx(0));
  while (z.length < p.length) z.push(0);
  const sections = (p.length + 1) >> 1;
  if (p.length % 2 === 1) {
    p.push(cx(0));
    z.push(0);
  }
  z = cplxreal(z.map((v) => cx(v))).reals;
  const split = cplxreal(p);
  p = [...split.pairs, ...split.reals.map((v) => cx(v))];
  const isReal = (c: Cx) => c.im === 0;
  const sos: Sos = [];
  for (let si = sections - 1; si >= 0; si--) {
    const p1 = p.splice(worst(p), 1)[0];
    let b: [number, number, number];
    let a: [number, number, number];
    if (isReal(p1) && !p.some(isReal)) {
      // The last real pole: a first order section, padded with the origin.
      const z1 = z.splice(nearest(z, p1), 1)[0];
      b = polyReal([z1, 0]);
      a = polyPoles([p1, cx(0)]);
    } else {
      let p2: Cx;
      if (isReal(p1)) p2 = p.splice(worst(p, isReal), 1)[0];
      else p2 = cx(p1.re, -p1.im);
      if (z.length > 0) {
        const z1 = z.splice(nearest(z, p1), 1)[0];
        if (z.length > 0) {
          const z2 = z.splice(nearest(z, p1), 1)[0];
          b = polyReal([z1, z2]);
        } else {
          b = polyReal([z1]);
        }
      } else {
        b = polyReal([]);
      }
      a = polyPoles([p1, p2]);
    }
    sos[si] = [b[0], b[1], b[2], a[0], a[1], a[2]];
  }
  sos[0][0] *= k;
  sos[0][1] *= k;
  sos[0][2] *= k;
  return sos;
}

/**
 * Digital Butterworth band pass of the given order (2 * order poles) between
 * band[0] and band[1] Hz at fs Hz, as second order sections. Equal to
 * scipy.signal.butter(order, band, btype="bandpass", fs=fs, output="sos"),
 * including section order and where the overall gain sits.
 */
export function butterBandpass(order: number, band: [number, number], fs: number): Sos {
  const [lo, hi] = band;
  if (!Number.isInteger(order) || order < 1) throw new RangeError(`dsp: filter order must be a positive integer, got ${order}`);
  if (!(fs > 0) || !(lo > 0) || !(lo < hi) || !(hi < fs / 2)) {
    throw new RangeError(`dsp: band [${lo}, ${hi}] Hz must satisfy 0 < lo < hi < fs / 2 (fs ${fs})`);
  }
  // SciPy normalises to the Nyquist rate, then designs at fs = 2.
  const w0 = 2 * 2 * Math.tan((Math.PI * ((2 * lo) / fs)) / 2);
  const w1 = 2 * 2 * Math.tan((Math.PI * ((2 * hi) / fs)) / 2);
  const bw = w1 - w0;
  const wo = Math.sqrt(w0 * w1);

  // Analog low pass prototype: order poles on the left half unit circle.
  const proto: Cx[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const theta = (Math.PI * m) / (2 * order);
    proto.push(cx(-Math.cos(theta), -Math.sin(theta)));
  }

  // Low pass to band pass: each pole splits in two, order zeros at the origin.
  const plus: Cx[] = [];
  const minus: Cx[] = [];
  for (const p of proto) {
    const lp = cx((p.re * bw) / 2, (p.im * bw) / 2);
    const s = csqrt(csub(cmul(lp, lp), cx(wo * wo)));
    plus.push(cadd(lp, s));
    minus.push(csub(lp, s));
  }
  const analog = [...plus, ...minus];
  const kAnalog = Math.pow(bw, order);

  // Bilinear transform at fs = 2: zeros at the origin land on z = 1, the ones
  // at infinity on z = -1.
  const fs2 = cx(4);
  const poles = analog.map((p) => cdiv(cadd(fs2, p), csub(fs2, p)));
  let num = cx(1);
  for (let i = 0; i < order; i++) num = cmul(num, fs2);
  let den = cx(1);
  for (const p of analog) den = cmul(den, csub(fs2, p));
  const k = kAnalog * cdiv(num, den).re;

  const zeros: number[] = [];
  for (let i = 0; i < order; i++) zeros.push(1);
  for (let i = 0; i < order; i++) zeros.push(-1);
  return zpk2sos(zeros, poles, k);
}

/* ---- Streaming filter --------------------------------------------------- */

/**
 * A cascade of second order sections in transposed direct form II, zero
 * initial state, one independent state per channel: the streaming form of
 * scipy.signal.sosfilt, same arithmetic in the same order.
 */
export class SosFilter {
  readonly sections: number;
  readonly channels: number;
  /** Per section: b0, b1, b2, a1, a2 (normalised so a0 = 1). */
  private readonly coef: Float64Array;
  /** Per channel, per section: the two delay states. */
  private readonly state: Float64Array;

  constructor(sos: Sos, channels: number) {
    if (sos.length === 0) throw new RangeError("dsp: a filter needs at least one section");
    if (!Number.isInteger(channels) || channels < 1) throw new RangeError(`dsp: channels must be a positive integer, got ${channels}`);
    this.sections = sos.length;
    this.channels = channels;
    this.coef = new Float64Array(this.sections * 5);
    sos.forEach((s, i) => {
      if (s.length !== 6 || s[3] === 0) throw new RangeError(`dsp: section ${i} must be [b0, b1, b2, a0, a1, a2] with a0 != 0`);
      const a0 = s[3];
      this.coef.set([s[0] / a0, s[1] / a0, s[2] / a0, s[4] / a0, s[5] / a0], i * 5);
    });
    this.state = new Float64Array(channels * this.sections * 2);
  }

  /** Filters one sample of one channel and returns the output. */
  step(channel: number, x: number): number {
    const c = this.coef;
    const z = this.state;
    let zi = channel * this.sections * 2;
    let y = x;
    for (let s = 0, ci = 0; s < this.sections; s++, ci += 5, zi += 2) {
      const xin = y;
      y = c[ci] * xin + z[zi];
      z[zi] = c[ci + 1] * xin - c[ci + 3] * y + z[zi + 1];
      z[zi + 1] = c[ci + 2] * xin - c[ci + 4] * y;
    }
    return y;
  }

  /** Filters a block of one channel in place, continuing from its state. */
  processInPlace(channel: number, data: Float32Array | Float64Array): void {
    for (let i = 0; i < data.length; i++) data[i] = this.step(channel, data[i]);
  }

  reset(): void {
    this.state.fill(0);
  }
}

/* ---- Streaming resampler ------------------------------------------------ */

/**
 * Linear interpolation from fsIn to fsOut, one frame (a sample per channel)
 * at a time: the streaming form of pipeline.decimate. Output k is the input
 * at position k * fsIn / fsOut, input sample 0 being position 0, and it is
 * emitted as soon as the sample after that position has arrived. Positions
 * are computed fresh from k, so hours of streaming never drift.
 *
 * Decimating this way does not low pass first: the chain band passes well
 * below the output Nyquist rate before it gets here.
 */
export class LinearResampler {
  readonly fsIn: number;
  readonly fsOut: number;
  readonly channels: number;
  private readonly ratio: number;
  private prev: Float64Array;
  private cur: Float64Array;
  /** Reused for every emitted frame: copy it if you keep it. */
  private readonly frame: Float64Array;
  /** Input frames pushed so far. */
  private pushed = 0;
  /** Index of the next output frame. */
  private next = 0;

  constructor(fsIn: number, fsOut: number, channels: number) {
    if (!(fsIn > 0) || !(fsOut > 0)) throw new RangeError(`dsp: sample rates must be positive, got ${fsIn} and ${fsOut}`);
    if (!Number.isInteger(channels) || channels < 1) throw new RangeError(`dsp: channels must be a positive integer, got ${channels}`);
    this.fsIn = fsIn;
    this.fsOut = fsOut;
    this.channels = channels;
    this.ratio = fsIn / fsOut;
    this.prev = new Float64Array(channels);
    this.cur = new Float64Array(channels);
    this.frame = new Float64Array(channels);
  }

  /**
   * Consumes one input frame and calls out once per output frame it
   * completes (none, one, or several when upsampling). The frame passed to
   * out is reused on the next call.
   */
  push(frame: ArrayLike<number>, out: (frame: Float64Array) => void): void {
    const swap = this.prev;
    this.prev = this.cur;
    this.cur = swap;
    const cur = this.cur;
    const prev = this.prev;
    for (let c = 0; c < this.channels; c++) cur[c] = frame[c];
    const last = this.pushed++;
    // Every earlier output was emitted on an earlier push, so an output
    // emitted now always sits between the previous frame and this one.
    for (;;) {
      const pos = this.next * this.ratio;
      const i = Math.floor(pos);
      if (i + 1 > last) break;
      const frac = pos - i;
      for (let c = 0; c < this.channels; c++) this.frame[c] = prev[c] * (1 - frac) + cur[c] * frac;
      this.next++;
      out(this.frame);
    }
  }

  reset(): void {
    this.prev.fill(0);
    this.cur.fill(0);
    this.pushed = 0;
    this.next = 0;
  }
}

/* ---- Movement gate ------------------------------------------------------ */

/** Gate defaults: a sample over this many times its channel's spread... */
export const GATE_THRESHOLD = 5;
/** ...blanks every channel for this long, seconds, from that sample on. */
export const GATE_HOLD_S = 0.5;

/**
 * Blanks every channel of the scaled 64 Hz frames for a while after any one
 * of them goes past GATE_THRESHOLD times its spread, so a movement jolt
 * cannot drive a decision. Causal: nothing is delayed, the blanking starts at
 * the sample that crossed. research/aad/hardware_bars.py (gatedc) measured it
 * with the final networks on people they never saw: two 200 uV jolts a minute
 * took one minute accuracy from 78% to 73% ungated and kept 77% gated, ten a
 * minute 64% against 72%; and on the clean recordings, scored with all five
 * networks of every split (gate_check.py), it changed one minute accuracy
 * from 78.9% to 79.2% and five minute from 91.0% to 92.1%. The Python
 * reference is causal_gate() there, sample for sample.
 */
export class ArtifactGate {
  readonly threshold: number;
  readonly holdSamples: number;
  private left = 0;

  constructor(fs: number, threshold = GATE_THRESHOLD, holdSeconds = GATE_HOLD_S) {
    if (!(threshold > 0)) throw new RangeError(`gate: threshold must be positive, got ${threshold}`);
    if (!(holdSeconds >= 0)) throw new RangeError(`gate: holdSeconds must be zero or more, got ${holdSeconds}`);
    this.threshold = threshold;
    this.holdSamples = Math.round(holdSeconds * fs);
  }

  /** One frame of scaled channels, blanked in place when the gate is shut. True when it was blanked. */
  apply(frame: Float64Array): boolean {
    for (let c = 0; c < frame.length; c++) {
      if (Math.abs(frame[c]) > this.threshold) {
        this.left = this.holdSamples;
        break;
      }
    }
    if (this.left <= 0) return false;
    frame.fill(0);
    this.left--;
    return true;
  }

  /** Samples it will still blank. */
  get closing(): number {
    return this.left;
  }
}
