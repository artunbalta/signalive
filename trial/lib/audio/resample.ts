/**
 * Streaming windowed-sinc resampler.
 *
 * Every conversion to 16 kHz (VAD, recognizers, the lab's offline chains)
 * goes through this one implementation instead of the browser's, because
 * browsers resample differently and the lab compares devices and browsers.
 *
 * The low-pass cutoff sits at 95% of the lower Nyquist frequency, with a
 * Blackman windowed sinc spanning 16 zero crossings, which keeps aliasing
 * well below the level of speech. The kernel is tabulated at 256 points per
 * zero crossing and linearly interpolated.
 */

const ZERO_CROSSINGS = 16;
const TABLE_RES = 256;
const CUTOFF = 0.95;

const tables = new Map<string, Float32Array>();

function kernelTable(): Float32Array {
  const key = "k";
  let t = tables.get(key);
  if (t) return t;
  const half = ZERO_CROSSINGS * TABLE_RES;
  t = new Float32Array(half + 2);
  for (let i = 0; i <= half + 1; i++) {
    const x = i / TABLE_RES; // in zero crossings
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const u = Math.min(1, x / ZERO_CROSSINGS); // 0..1 across the half window
    const blackman = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
    t[i] = u >= 1 ? 0 : sinc * blackman;
  }
  tables.set(key, t);
  return t;
}

export class StreamingResampler {
  private readonly step: number;
  /** Kernel scale: < 1 when downsampling, so the low-pass follows the output rate. */
  private readonly scale: number;
  private readonly halfWidth: number;
  private readonly table = kernelTable();
  private buf: Float32Array = new Float32Array(0);
  /** Position of the next output sample, in input samples relative to buf[0]. */
  private pos: number;

  constructor(
    readonly inRate: number,
    readonly outRate: number,
  ) {
    this.step = inRate / outRate;
    this.scale = Math.min(1, outRate / inRate) * CUTOFF;
    this.halfWidth = Math.ceil(ZERO_CROSSINGS / this.scale);
    // Start with a full half window of virtual zeros so output 0 is input 0.
    this.buf = new Float32Array(this.halfWidth);
    this.pos = this.halfWidth;
  }

  private sample(center: number): number {
    const first = Math.ceil(center - this.halfWidth);
    const last = Math.floor(center + this.halfWidth);
    let acc = 0;
    let norm = 0;
    for (let k = first; k <= last; k++) {
      const x = Math.abs(k - center) * this.scale * TABLE_RES;
      const i = Math.floor(x);
      if (i >= this.table.length - 1) continue;
      const frac = x - i;
      const w = this.table[i]! + (this.table[i + 1]! - this.table[i]!) * frac;
      acc += (this.buf[k] ?? 0) * w;
      norm += w;
    }
    // Normalizing by the kernel sum keeps DC gain exactly 1.
    return norm !== 0 ? acc / norm : 0;
  }

  process(input: Float32Array): Float32Array {
    if (this.inRate === this.outRate) return input.slice();
    const merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf);
    merged.set(input, this.buf.length);
    this.buf = merged;

    const out: number[] = [];
    while (this.pos + this.halfWidth < this.buf.length) {
      out.push(this.sample(this.pos));
      this.pos += this.step;
    }
    // Keep only what future outputs can still reach.
    const keepFrom = Math.max(0, Math.floor(this.pos - this.halfWidth) - 1);
    if (keepFrom > 0) {
      this.buf = this.buf.slice(keepFrom);
      this.pos -= keepFrom;
    }
    return Float32Array.from(out);
  }

  /** Emits the samples still held back for the look-ahead. */
  flush(): Float32Array {
    if (this.inRate === this.outRate) return new Float32Array(0);
    return this.process(new Float32Array(this.halfWidth + 1));
  }
}

/** One-shot conversion of a whole buffer. */
export function resample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input.slice();
  const r = new StreamingResampler(inRate, outRate);
  const a = r.process(input);
  const b = r.flush();
  const expected = Math.round((input.length * outRate) / inRate);
  const out = new Float32Array(expected);
  out.set(a.subarray(0, Math.min(a.length, expected)));
  if (a.length < expected) out.set(b.subarray(0, expected - a.length), a.length);
  return out;
}
