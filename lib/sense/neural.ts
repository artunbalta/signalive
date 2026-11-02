/**
 * The learned attention decoder (research/aad/deep.py) on the phone.
 *
 * Two small networks of one dimensional convolutions: one reads the derived
 * EEG channels, the other reads one talker's speech envelope, and over a
 * decision window the talker whose embedding moves most with the EEG's is
 * the one being listened to. A model carries a few such pairs, trained from
 * different starting points; a window's scores are their average.
 *
 * Before the networks the chain is the linear decoder's (band pass at the
 * electrode rate, resampling, montage), then two scales that need no labels:
 * each derived channel by the wearer's own spread over their first minutes,
 * each envelope by its own recent spread.
 *
 * Every layer streams. A layer's output for sample t reads its input from
 * t - reach to t + reach (centred) or from t - reach to t (reaching back),
 * sees zeros before sample 0, and is computed the moment its last input
 * arrives, so an embedding is final `lag` samples (28, 0.44 s) after its own
 * sample: exactly the reference chain in research/aad/deep_export.py.
 *
 * Embedding sample i, EEG sample i and envelope sample i describe the same
 * instant. History lives in fixed ring buffers; nothing in the per sample
 * path allocates.
 */
import { LinearResampler, SosFilter, type Sos } from "./dsp";
import type { Decision, DecoderOptions } from "./decoder";

export interface ConvLayer {
  in: number;
  out: number;
  kernel: number;
  dilation: number;
  /** 0: the kernel reaches back from t; otherwise centred, padding samples each way. */
  padding: number;
  gelu: boolean;
}

/** A trained learned decoder, as research/aad/deep_export.py writes it. */
export interface NeuralDecoderModel {
  version: 2;
  kind: "neural";
  fsRaw: number;
  fs: number;
  /** Electrode names, in the order raw frames carry them. */
  inputs: string[];
  sosRaw: Sos;
  sosEnv: Sos;
  /** Derived channels x inputs. */
  montage: number[][];
  /** Starting scale per derived channel, until the wearer's own is known. */
  scale: number[];
  /** How much of the wearer's EEG sets their scale, seconds. */
  warmupSeconds: number;
  /** Time constant of each envelope's running spread, seconds. */
  envTauSeconds: number;
  eeg: ConvLayer[];
  env: ConvLayer[];
  /** One per network: every layer's weights (out x in x kernel) then biases, little endian float32, base64. */
  weights: string[];
  /** Log odds per unit of margin for a decision over decisionSeconds, fitted on people the networks never saw. */
  eegWeight: number | null;
  decisionSeconds: number;
}

export interface NeuralDecoderOptions extends DecoderOptions {
  /**
   * Replace the model's starting scale with the wearer's own spread over
   * their first warmupSeconds. Default true; false keeps model.scale, as a
   * test against a fixed reference does.
   */
  adaptScale?: boolean;
}

const SQRT1_2 = Math.SQRT1_2;
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

/**
 * The error function to about 1e-15: a series of positive terms below 3 (no
 * cancellation), a continued fraction for the tail above it, exact past 6.
 */
export function erf(x: number): number {
  const a = Math.abs(x);
  if (a >= 6) return Math.sign(x);
  if (a < 3) {
    // erf(x) = 2 / sqrt(pi) * exp(-x^2) * sum 2^n x^(2n+1) / (2n+1)!!
    const x2 = a * a;
    let term = a;
    let sum = a;
    for (let n = 0; n < 200; n++) {
      term *= (2 * x2) / (2 * n + 3);
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return Math.sign(x) * TWO_OVER_SQRT_PI * Math.exp(-x2) * sum;
  }
  // erfc(x) = exp(-x^2) / sqrt(pi) / (x + (1/2) / (x + (2/2) / (x + (3/2) / ...)))
  let f = a;
  for (let k = 60; k >= 1; k--) f = a + k / 2 / f;
  const erfc = Math.exp(-a * a) / Math.sqrt(Math.PI) / f;
  return Math.sign(x) * (1 - erfc);
}

/** GELU as PyTorch defines it, with the exact error function. */
export function gelu(x: number): number {
  return 0.5 * x * (1 + erf(x * SQRT1_2));
}

/** base64 of little endian float32, as float64. */
function floats(b64: string): Float64Array {
  const bin = atob(b64);
  if (bin.length % 4 !== 0) throw new RangeError("neural: weights must be whole float32 values");
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const out = new Float64Array(bin.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/**
 * One convolution, one frame in and at most one frame out per push. Output t
 * reads inputs t + j * dilation - reach for j = 0 to kernel - 1, where reach
 * is padding (centred) or (kernel - 1) * dilation (reaching back); either
 * way the newest input it needs is t + lag, so it is computed when that
 * input arrives.
 */
class StreamConv {
  readonly lag: number;
  /** The newest output; reused on every push. */
  readonly out: Float64Array;
  private readonly cin: number;
  private readonly cout: number;
  private readonly k: number;
  private readonly d: number;
  private readonly span: number;
  private readonly ring: Float64Array;
  private readonly w: Float64Array;
  private readonly b: Float64Array;
  private readonly act: boolean;
  private pushed = 0;

  constructor(spec: ConvLayer, w: Float64Array, b: Float64Array) {
    if (spec.padding !== 0 && 2 * spec.padding !== (spec.kernel - 1) * spec.dilation) {
      throw new RangeError(`neural: a centred layer needs padding (kernel - 1) * dilation / 2, got ${spec.padding}`);
    }
    this.cin = spec.in;
    this.cout = spec.out;
    this.k = spec.kernel;
    this.d = spec.dilation;
    this.lag = spec.padding;
    this.span = (spec.kernel - 1) * spec.dilation + 1;
    this.ring = new Float64Array(this.span * spec.in);
    this.out = new Float64Array(spec.out);
    this.w = w;
    this.b = b;
    this.act = spec.gelu;
  }

  /** Takes input frame u; true when that completes output u - lag, now in out. */
  push(x: ArrayLike<number>): boolean {
    const u = this.pushed++;
    const cin = this.cin;
    const base = (u % this.span) * cin;
    for (let i = 0; i < cin; i++) this.ring[base + i] = x[i];
    if (u < this.lag) return false;
    const k = this.k;
    const first = u - (k - 1) * this.d;
    for (let o = 0; o < this.cout; o++) {
      let acc = this.b[o];
      const wo = o * cin * k;
      for (let j = 0; j < k; j++) {
        const v = first + j * this.d;
        // Before sample 0 every input is zero.
        if (v < 0) continue;
        const slot = (v % this.span) * cin;
        for (let i = 0; i < cin; i++) acc += this.w[wo + i * k + j] * this.ring[slot + i];
      }
      this.out[o] = this.act ? gelu(acc) : acc;
    }
    return true;
  }

  reset(): void {
    this.ring.fill(0);
    this.out.fill(0);
    this.pushed = 0;
  }
}

/** A stack of layers; push returns the finished embedding, or null while it waits for input ahead. */
class StreamNet {
  readonly lag: number;
  readonly width: number;
  /** Weights this net read from its blob. */
  readonly used: number;
  private readonly layers: StreamConv[];

  constructor(specs: ConvLayer[], blob: Float64Array, offset: number) {
    this.layers = [];
    let at = offset;
    for (const L of specs) {
      const nw = L.out * L.in * L.kernel;
      const w = blob.subarray(at, at + nw);
      at += nw;
      const b = blob.subarray(at, at + L.out);
      at += L.out;
      this.layers.push(new StreamConv(L, w, b));
    }
    this.lag = this.layers.reduce((s, l) => s + l.lag, 0);
    this.width = specs[specs.length - 1].out;
    this.used = at - offset;
  }

  push(x: ArrayLike<number>): Float64Array | null {
    let v: ArrayLike<number> = x;
    for (const layer of this.layers) {
      if (!layer.push(v)) return null;
      v = layer.out;
    }
    return v as Float64Array;
  }

  reset(): void {
    for (const l of this.layers) l.reset();
  }
}

/** How many weights and biases a stack of layers holds. */
function size(specs: ConvLayer[]): number {
  return specs.reduce((s, L) => s + L.out * L.in * L.kernel + L.out, 0);
}

export class NeuralAttentionDecoder {
  readonly fs: number;
  readonly talkers: number;
  /** Derived channels. */
  readonly channels: number;
  /** Raw electrode channels. */
  readonly inputs: number;
  /** Samples of embedding history kept. */
  readonly capacity: number;
  /** Samples between an input and the embedding it completes. */
  readonly lag: number;
  /** Embedding width. */
  readonly width: number;
  /** Networks averaged per decision. */
  readonly networks: number;
  /** Log odds per unit of margin the model was calibrated to, or null. */
  readonly eegWeight: number | null;

  private readonly rawFilter: SosFilter;
  private readonly resampler: LinearResampler;
  private readonly envFilter: SosFilter;
  private readonly montage: Float64Array;
  private readonly scale0: Float64Array;
  private readonly scale: Float64Array;
  private readonly adapt: boolean;
  private readonly warmup: number;
  private readonly sumSq: Float64Array;
  private warmed = 0;
  private readonly envAlpha: number;
  private readonly envMs: Float64Array;
  private readonly envSeen: number[];
  private readonly filtered: Float64Array;
  private readonly lastRaw: Float64Array;
  private readonly lastEnv: Float64Array;
  private readonly derived: Float64Array;
  private readonly one = new Float64Array(1);
  private readonly eegNets: StreamNet[];
  /** envNets[n][talker]: each talker streams through its own copy of network n's stimulus side. */
  private readonly envNets: StreamNet[][];
  /** eegEmb[n]: width x capacity, sample t at column t % capacity. */
  private readonly eegEmb: Float64Array[];
  private readonly envEmb: Float64Array[][];
  private featCount = 0;
  private eegCount = 0;
  private readonly envCount: number[];
  private readonly envEmbCount: number[];
  private readonly onResampled: (frame: Float64Array) => void;

  constructor(model: NeuralDecoderModel, talkers: number, opts: NeuralDecoderOptions = {}) {
    if (model.version !== 2 || model.kind !== "neural") throw new Error(`neural: unsupported model ${String(model.version)} ${String(model.kind)}`);
    if (!Number.isInteger(talkers) || talkers < 1) throw new RangeError(`neural: talkers must be a positive integer, got ${talkers}`);
    if (!(model.fs > 0) || !(model.fsRaw > 0)) throw new RangeError("neural: model sample rates must be positive");
    const nIn = model.inputs.length;
    const nCh = model.montage.length;
    if (nIn < 1 || nCh < 1) throw new RangeError("neural: the model needs at least one input and one derived channel");
    model.montage.forEach((row, c) => {
      if (row.length !== nIn) throw new RangeError(`neural: montage row ${c} has ${row.length} entries for ${nIn} inputs`);
    });
    if (model.scale.length !== nCh) throw new RangeError(`neural: scale has ${model.scale.length} entries for ${nCh} derived channels`);
    if (model.eeg[0]?.in !== nCh) throw new RangeError(`neural: the EEG network reads ${model.eeg[0]?.in} channels, the montage makes ${nCh}`);
    if (model.env[0]?.in !== 1) throw new RangeError("neural: the stimulus network must read one envelope");
    const width = model.eeg[model.eeg.length - 1].out;
    if (model.env[model.env.length - 1].out !== width) throw new RangeError("neural: the two networks must end in embeddings of the same width");
    if (model.weights.length < 1) throw new RangeError("neural: the model has no networks");
    const history = opts.historySeconds ?? 60;
    if (!(history > 0)) throw new RangeError(`neural: historySeconds must be positive, got ${history}`);

    this.fs = model.fs;
    this.talkers = talkers;
    this.channels = nCh;
    this.inputs = nIn;
    this.capacity = Math.max(2, Math.ceil(history * model.fs));
    this.width = width;
    this.networks = model.weights.length;
    this.eegWeight = typeof model.eegWeight === "number" && Number.isFinite(model.eegWeight) ? model.eegWeight : null;

    this.rawFilter = new SosFilter(model.sosRaw, nIn);
    this.resampler = new LinearResampler(model.fsRaw, model.fs, nIn);
    this.envFilter = new SosFilter(model.sosEnv, talkers);
    this.montage = Float64Array.from(model.montage.flat());
    this.scale0 = Float64Array.from(model.scale);
    this.scale = Float64Array.from(model.scale);
    this.adapt = opts.adaptScale ?? true;
    this.warmup = Math.max(1, Math.round(model.warmupSeconds * model.fs));
    this.sumSq = new Float64Array(nCh);
    this.envAlpha = 1 / (model.envTauSeconds * model.fs);
    this.envMs = new Float64Array(talkers);
    this.envSeen = new Array<number>(talkers).fill(0);
    this.filtered = new Float64Array(nIn);
    this.lastRaw = new Float64Array(nIn);
    this.lastEnv = new Float64Array(talkers);
    this.derived = new Float64Array(nCh);

    const eegSize = size(model.eeg);
    const envSize = size(model.env);
    this.eegNets = [];
    this.envNets = [];
    for (const b64 of model.weights) {
      const blob = floats(b64);
      if (blob.length !== eegSize + envSize) throw new RangeError(`neural: a network has ${blob.length} weights, its layers need ${eegSize + envSize}`);
      this.eegNets.push(new StreamNet(model.eeg, blob, 0));
      this.envNets.push(Array.from({ length: talkers }, () => new StreamNet(model.env, blob, eegSize)));
    }
    const lag = this.eegNets[0].lag;
    if (this.envNets[0][0].lag !== lag) throw new RangeError("neural: both networks must reach equally far ahead");
    this.lag = lag;
    this.eegEmb = this.eegNets.map(() => new Float64Array(width * this.capacity));
    this.envEmb = this.eegNets.map(() => Array.from({ length: talkers }, () => new Float64Array(width * this.capacity)));
    this.envCount = new Array<number>(talkers).fill(0);
    this.envEmbCount = new Array<number>(talkers).fill(0);
    this.onResampled = (frame) => this.mix(frame);
  }

  /**
   * One raw frame at fsRaw: a sample per electrode in model.inputs order, in
   * microvolts. A sample that is not a finite number repeats that
   * electrode's last good value.
   */
  pushRaw(frame: ArrayLike<number>): void {
    const last = this.lastRaw;
    for (let i = 0; i < this.inputs; i++) {
      const x = frame[i];
      if (Number.isFinite(x)) last[i] = x;
      this.filtered[i] = this.rawFilter.step(i, last[i]);
    }
    this.resampler.push(this.filtered, this.onResampled);
  }

  /** Montage, the wearer's scale, then the EEG networks. */
  private mix(frame: Float64Array): void {
    const m = this.montage;
    const C = this.channels;
    for (let c = 0, row = 0; c < C; c++, row += this.inputs) {
      let acc = 0;
      for (let i = 0; i < this.inputs; i++) acc += m[row + i] * frame[i];
      this.derived[c] = acc;
    }
    if (this.adapt && this.warmed < this.warmup) {
      // The wearer's own spread over their first minutes, unlabelled; from a
      // second in, the spread so far stands in for it.
      this.warmed++;
      for (let c = 0; c < C; c++) this.sumSq[c] += this.derived[c] * this.derived[c];
      if (this.warmed >= Math.min(this.fs, this.warmup)) {
        for (let c = 0; c < C; c++) {
          const ms = this.sumSq[c] / this.warmed;
          if (ms > 0) this.scale[c] = 1 / Math.sqrt(ms);
        }
      }
    }
    for (let c = 0; c < C; c++) this.derived[c] *= this.scale[c];
    this.pushFeatures(this.derived);
  }

  /** One frame that is already derived and scaled, at fs: the bypass for precomputed features. */
  pushFeatures(frame: ArrayLike<number>): void {
    this.featCount++;
    let done = false;
    for (let n = 0; n < this.networks; n++) {
      const z = this.eegNets[n].push(frame);
      if (!z) continue;
      done = true;
      const buf = this.eegEmb[n];
      const col = this.eegCount % this.capacity;
      for (let c = 0; c < this.width; c++) buf[c * this.capacity + col] = z[c];
    }
    if (done) this.eegCount++;
  }

  /**
   * One envelope sample of one talker at fs, aligned with feature sample i
   * for the i-th call. Band passed with the model's sosEnv unless filtered,
   * then scaled by its own running spread: the plain mean square over the
   * first second, an exponential average after it.
   */
  pushEnvelope(talker: number, value: number, filtered = false): void {
    if (!(talker >= 0 && talker < this.talkers) || !Number.isInteger(talker)) {
      throw new RangeError(`neural: talker ${talker} out of range 0 to ${this.talkers - 1}`);
    }
    if (Number.isFinite(value)) this.lastEnv[talker] = value;
    const x = this.lastEnv[talker];
    const v = filtered ? x : this.envFilter.step(talker, x);
    const seen = this.envSeen[talker]++;
    const ms = this.envMs[talker];
    this.envMs[talker] = seen < this.fs ? ms + (v * v - ms) / (seen + 1) : ms + this.envAlpha * (v * v - ms);
    this.one[0] = v / Math.sqrt(Math.max(this.envMs[talker], 1e-12));
    this.envCount[talker]++;
    let done = false;
    for (let n = 0; n < this.networks; n++) {
      const z = this.envNets[n][talker].push(this.one);
      if (!z) continue;
      done = true;
      const buf = this.envEmb[n][talker];
      const col = this.envEmbCount[talker] % this.capacity;
      for (let c = 0; c < this.width; c++) buf[c * this.capacity + col] = z[c];
    }
    if (done) this.envEmbCount[talker]++;
  }

  /** EEG embedding samples final so far; sample count - 1 is the newest. */
  get count(): number {
    return this.eegCount;
  }

  /** Feature frames received so far, at fs. */
  get featureCount(): number {
    return this.featCount;
  }

  /** Envelope samples received so far for one talker. */
  envelopeCount(talker: number): number {
    return this.envCount[talker] ?? 0;
  }

  /** The current scale per derived channel: the model's, or the wearer's once known. */
  get channelScale(): Float64Array {
    return this.scale.slice();
  }

  /** One network's EEG embedding at sample t, or null if it is not final or no longer kept. */
  eegEmbedding(t: number, network = 0): Float64Array | null {
    if (!(t >= 0 && t < this.eegCount && t >= this.eegCount - this.capacity)) return null;
    const out = new Float64Array(this.width);
    for (let c = 0; c < this.width; c++) out[c] = this.eegEmb[network][c * this.capacity + (t % this.capacity)];
    return out;
  }

  /** One network's embedding of one talker's envelope at sample t, or null. */
  envEmbedding(talker: number, t: number, network = 0): Float64Array | null {
    const have = this.envEmbCount[talker];
    if (!(t >= 0 && t < have && t >= have - this.capacity)) return null;
    const out = new Float64Array(this.width);
    for (let c = 0; c < this.width; c++) out[c] = this.envEmb[network][talker][c * this.capacity + (t % this.capacity)];
    return out;
  }

  /** The exclusive end of the newest window that could be decided now: where every embedding is final. */
  get decidable(): number {
    let end = this.eegCount;
    for (const n of this.envEmbCount) end = Math.min(end, n);
    return end;
  }

  /** Decides over the most recent window of windowSeconds where every embedding is final, or null. */
  decide(windowSeconds: number): Decision | null {
    const length = Math.round(windowSeconds * this.fs);
    const end = this.decidable;
    return this.decideRange(end - length, length);
  }

  /**
   * Decides over embedding samples [start, start + length), or null if any
   * of them is missing. Per network and talker, the training objective:
   * both embeddings centred over the window, their mean product over the
   * product of their mean norms; r holds the networks' average per talker.
   */
  decideRange(start: number, length: number): Decision | null {
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 2) return null;
    const end = start + length;
    const cap = this.capacity;
    if (end > this.eegCount || start < this.eegCount - cap) return null;
    for (const n of this.envEmbCount) if (end > n || start < n - cap) return null;

    const W = this.width;
    const r = new Array<number>(this.talkers).fill(0);
    const meanA = new Float64Array(W);
    const meanB = new Float64Array(W);
    for (let n = 0; n < this.networks; n++) {
      const A = this.eegEmb[n];
      meanA.fill(0);
      for (let c = 0; c < W; c++) {
        const row = c * cap;
        let s = 0;
        for (let i = start; i < end; i++) s += A[row + (i % cap)];
        meanA[c] = s / length;
      }
      let na = 0;
      for (let i = start; i < end; i++) {
        let s = 0;
        for (let c = 0; c < W; c++) {
          const a = A[c * cap + (i % cap)] - meanA[c];
          s += a * a;
        }
        na += Math.sqrt(s);
      }
      na /= length;
      for (let k = 0; k < this.talkers; k++) {
        const B = this.envEmb[n][k];
        for (let c = 0; c < W; c++) {
          const row = c * cap;
          let s = 0;
          for (let i = start; i < end; i++) s += B[row + (i % cap)];
          meanB[c] = s / length;
        }
        let nb = 0;
        let dot = 0;
        for (let i = start; i < end; i++) {
          let sb = 0;
          for (let c = 0; c < W; c++) {
            const slot = c * cap + (i % cap);
            const b = B[slot] - meanB[c];
            sb += b * b;
            dot += (A[slot] - meanA[c]) * b;
          }
          nb += Math.sqrt(sb);
        }
        nb /= length;
        r[k] += dot / length / (na * nb + 1e-6) / this.networks;
      }
    }
    let best = 0;
    for (let s = 1; s < r.length; s++) if (r[s] > r[best]) best = s;
    let second = -Infinity;
    for (let s = 0; s < r.length; s++) if (s !== best && r[s] > second) second = r[s];
    const margin = r.length > 1 ? r[best] - second : r[best];
    return { talker: best, r, margin, end };
  }

  /** Forgets every sample, filter state and the wearer's scale, as if just constructed. */
  reset(): void {
    this.rawFilter.reset();
    this.resampler.reset();
    this.envFilter.reset();
    this.lastRaw.fill(0);
    this.lastEnv.fill(0);
    this.envMs.fill(0);
    this.envSeen.fill(0);
    this.sumSq.fill(0);
    this.warmed = 0;
    this.scale.set(this.scale0);
    for (const n of this.eegNets) n.reset();
    for (const row of this.envNets) for (const n of row) n.reset();
    for (const b of this.eegEmb) b.fill(0);
    for (const row of this.envEmb) for (const b of row) b.fill(0);
    this.featCount = 0;
    this.eegCount = 0;
    this.envCount.fill(0);
    this.envEmbCount.fill(0);
  }
}
