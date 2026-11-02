/**
 * Auditory attention decoding on the earbud: the streaming form of the chain
 * in research/aad/pipeline.py.
 *
 * Raw electrode samples are band passed at the electrode rate, resampled to
 * the model rate, mixed into derived channels (the montage) and scaled. A
 * linear backward model then reconstructs the attended speech envelope from
 * every derived channel over the next `lags` samples, and over a decision
 * window the talker whose envelope correlates best with that reconstruction
 * is the one being listened to.
 *
 * Every stream is indexed in samples at the model rate from time 0: feature
 * sample i, envelope sample i and reconstruction sample i describe the same
 * instant. Reconstruction sample t needs features up to t + lags - 1, so it
 * exists lags - 1 samples after its features do. History lives in fixed ring
 * buffers and nothing in the per sample path allocates.
 */
import { LinearResampler, SosFilter, type Sos } from "./dsp";

/** A trained decoder, as exported by the Python pipeline. */
export interface DecoderModel {
  version: 1;
  /** Electrode sample rate, Hz. */
  fsRaw: number;
  /** Model rate, Hz: features, envelopes and decisions all run at this rate. */
  fs: number;
  /** Electrode names, in the order raw frames carry them. */
  inputs: string[];
  /** Band pass applied to every electrode at fsRaw. */
  sosRaw: Sos;
  /** Band pass applied to every speech envelope at fs. */
  sosEnv: Sos;
  /** Derived channels x inputs: derived = montage times inputs. */
  montage: number[][];
  /** Per derived channel, applied after the montage. */
  scale: number[];
  /** Number of lags, in samples at fs. */
  lags: number;
  /** weights[c][k]: derived channel c at lag k. */
  weights: number[][];
}

/** The outcome of one decision window. */
export interface Decision {
  /** The talker whose envelope best matches the reconstruction. */
  talker: number;
  /** Pearson r of the reconstruction with each talker's envelope. */
  r: number[];
  /** Best r minus second best r; with a single talker, its r. */
  margin: number;
  /** Exclusive end of the window, in samples at fs. */
  end: number;
}

export interface DecoderOptions {
  /** How much reconstruction and envelope history to keep, seconds. Default 60. */
  historySeconds?: number;
}

export class AttentionDecoder {
  readonly fs: number;
  readonly talkers: number;
  readonly lags: number;
  /** Derived channels. */
  readonly channels: number;
  /** Raw electrode channels. */
  readonly inputs: number;
  /** Samples of reconstruction and envelope history kept. */
  readonly capacity: number;

  private readonly rawFilter: SosFilter;
  private readonly resampler: LinearResampler;
  private readonly envFilter: SosFilter;
  /** Derived x inputs, row major. */
  private readonly montage: Float64Array;
  private readonly scale: Float64Array;
  /** Channel major: weights[c * lags + k]. */
  private readonly weights: Float64Array;
  /** Scratch for one raw frame after the band pass. */
  private readonly filtered: Float64Array;
  /** Last finite value per input, standing in for dropped samples. */
  private readonly lastRaw: Float64Array;
  /** Last finite envelope value per talker, likewise. */
  private readonly lastEnv: Float64Array;
  /** Scratch for one derived frame. */
  private readonly derived: Float64Array;
  /** The last `lags` feature frames: frame i at slot i % lags. */
  private readonly feat: Float64Array;
  private featCount = 0;
  private readonly recon: Float64Array;
  private reconCount = 0;
  private readonly env: Float64Array[];
  private readonly envCount: number[];
  private readonly onResampled: (frame: Float64Array) => void;

  constructor(model: DecoderModel, talkers: number, opts: DecoderOptions = {}) {
    if (model.version !== 1) throw new Error(`decoder: unsupported model version ${String(model.version)}`);
    if (!Number.isInteger(talkers) || talkers < 1) throw new RangeError(`decoder: talkers must be a positive integer, got ${talkers}`);
    if (!(model.fs > 0) || !(model.fsRaw > 0)) throw new RangeError("decoder: model sample rates must be positive");
    if (!Number.isInteger(model.lags) || model.lags < 1) throw new RangeError(`decoder: lags must be a positive integer, got ${model.lags}`);
    const nIn = model.inputs.length;
    const nCh = model.montage.length;
    if (nIn < 1 || nCh < 1) throw new RangeError("decoder: the model needs at least one input and one derived channel");
    model.montage.forEach((row, c) => {
      if (row.length !== nIn) throw new RangeError(`decoder: montage row ${c} has ${row.length} entries for ${nIn} inputs`);
    });
    if (model.scale.length !== nCh) throw new RangeError(`decoder: scale has ${model.scale.length} entries for ${nCh} derived channels`);
    if (model.weights.length !== nCh) throw new RangeError(`decoder: weights has ${model.weights.length} rows for ${nCh} derived channels`);
    model.weights.forEach((row, c) => {
      if (row.length !== model.lags) throw new RangeError(`decoder: weights row ${c} has ${row.length} lags, expected ${model.lags}`);
    });
    const history = opts.historySeconds ?? 60;
    if (!(history > 0)) throw new RangeError(`decoder: historySeconds must be positive, got ${history}`);

    this.fs = model.fs;
    this.talkers = talkers;
    this.lags = model.lags;
    this.channels = nCh;
    this.inputs = nIn;
    this.capacity = Math.max(2, Math.ceil(history * model.fs));

    this.rawFilter = new SosFilter(model.sosRaw, nIn);
    this.resampler = new LinearResampler(model.fsRaw, model.fs, nIn);
    this.envFilter = new SosFilter(model.sosEnv, talkers);
    this.montage = Float64Array.from(model.montage.flat());
    this.scale = Float64Array.from(model.scale);
    this.weights = Float64Array.from(model.weights.flat());
    this.filtered = new Float64Array(nIn);
    this.lastRaw = new Float64Array(nIn);
    this.lastEnv = new Float64Array(talkers);
    this.derived = new Float64Array(nCh);
    this.feat = new Float64Array(model.lags * nCh);
    this.recon = new Float64Array(this.capacity);
    this.env = Array.from({ length: talkers }, () => new Float64Array(this.capacity));
    this.envCount = new Array<number>(talkers).fill(0);
    this.onResampled = (frame) => this.mix(frame);
  }

  /**
   * One raw frame at fsRaw: a sample per electrode in model.inputs order, in
   * microvolts. Band pass, resample, montage, scale, in that order. A sample
   * that is not a finite number repeats that electrode's last good value.
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

  /** Montage and scale for one resampled frame, then into the features. */
  private mix(frame: Float64Array): void {
    const m = this.montage;
    for (let c = 0, row = 0; c < this.channels; c++, row += this.inputs) {
      let acc = 0;
      for (let i = 0; i < this.inputs; i++) acc += m[row + i] * frame[i];
      this.derived[c] = acc * this.scale[c];
    }
    this.pushFeatures(this.derived);
  }

  /** One frame that is already derived and scaled, at fs: the bypass for precomputed features. */
  pushFeatures(frame: ArrayLike<number>): void {
    const C = this.channels;
    const L = this.lags;
    const feat = this.feat;
    const slot = (this.featCount % L) * C;
    for (let c = 0; c < C; c++) feat[slot + c] = frame[c];
    this.featCount++;
    if (this.featCount < L) return;
    // The oldest frame held is t, the newest t + L - 1: exactly what recon[t] needs.
    const t = this.featCount - L;
    const first = t % L;
    const w = this.weights;
    let acc = 0;
    for (let c = 0; c < C; c++) {
      const wc = c * L;
      for (let k = 0, s = first; k < L; k++) {
        acc += w[wc + k] * feat[s * C + c];
        if (++s === L) s = 0;
      }
    }
    this.recon[t % this.capacity] = acc;
    this.reconCount++;
  }

  /**
   * One envelope sample of one talker at fs, aligned with feature sample i
   * for the i-th call. Band passed with the model's sosEnv unless filtered.
   */
  pushEnvelope(talker: number, value: number, filtered = false): void {
    if (!(talker >= 0 && talker < this.talkers) || !Number.isInteger(talker)) {
      throw new RangeError(`decoder: talker ${talker} out of range 0 to ${this.talkers - 1}`);
    }
    // A sample lost on the way repeats the talker's last good one: one NaN
    // inside the band pass would poison its state for good.
    if (Number.isFinite(value)) this.lastEnv[talker] = value;
    const x = this.lastEnv[talker];
    const v = filtered ? x : this.envFilter.step(talker, x);
    const n = this.envCount[talker]++;
    this.env[talker][n % this.capacity] = v;
  }

  /** Reconstruction samples computed so far; sample count - 1 is the newest. */
  get count(): number {
    return this.reconCount;
  }

  /** Feature frames received so far, at fs. */
  get featureCount(): number {
    return this.featCount;
  }

  /** Envelope samples received so far for one talker. */
  envelopeCount(talker: number): number {
    return this.envCount[talker] ?? 0;
  }

  /**
   * Decides over the most recent window of windowSeconds where the
   * reconstruction and every envelope exist, or null while there is not
   * enough of them yet.
   */
  decide(windowSeconds: number): Decision | null {
    const length = Math.round(windowSeconds * this.fs);
    let end = this.reconCount;
    for (const n of this.envCount) end = Math.min(end, n);
    return this.decideRange(end - length, length);
  }

  /**
   * Decides over samples [start, start + length) at fs, or null if any of
   * them is missing (not computed yet, or older than the history kept).
   * Pearson r with the window mean removed, as window_correlations does.
   */
  decideRange(start: number, length: number): Decision | null {
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 2) return null;
    const end = start + length;
    const cap = this.capacity;
    if (end > this.reconCount || start < this.reconCount - cap) return null;
    for (const n of this.envCount) if (end > n || start < n - cap) return null;

    const recon = this.recon;
    let ma = 0;
    for (let i = start; i < end; i++) ma += recon[i % cap];
    ma /= length;
    let saa = 0;
    for (let i = start; i < end; i++) {
      const a = recon[i % cap] - ma;
      saa += a * a;
    }
    const r = new Array<number>(this.talkers);
    for (let s = 0; s < this.talkers; s++) {
      const env = this.env[s];
      let mb = 0;
      for (let i = start; i < end; i++) mb += env[i % cap];
      mb /= length;
      let sbb = 0;
      let sab = 0;
      for (let i = start; i < end; i++) {
        const a = recon[i % cap] - ma;
        const b = env[i % cap] - mb;
        sbb += b * b;
        sab += a * b;
      }
      r[s] = sab / (Math.sqrt(saa * sbb) + 1e-12);
    }
    let best = 0;
    for (let s = 1; s < r.length; s++) if (r[s] > r[best]) best = s;
    let second = -Infinity;
    for (let s = 0; s < r.length; s++) if (s !== best && r[s] > second) second = r[s];
    const margin = r.length > 1 ? r[best] - second : r[best];
    return { talker: best, r, margin, end };
  }

  /**
   * The newest n samples of the reconstruction (or as many as are kept), and
   * each talker's envelope over the same samples, for drawing. An envelope
   * sample that does not exist yet, or is no longer kept, is NaN. end is the
   * exclusive index of the last sample, in samples at fs.
   */
  recent(n: number): { recon: Float64Array; envelopes: Float64Array[]; end: number } {
    const cap = this.capacity;
    const end = this.reconCount;
    const len = Math.max(0, Math.min(Math.floor(n), end, cap));
    const start = end - len;
    const recon = new Float64Array(len);
    for (let i = 0; i < len; i++) recon[i] = this.recon[(start + i) % cap];
    const envelopes = this.env.map((buf, s) => {
      const out = new Float64Array(len);
      const have = this.envCount[s];
      for (let i = 0; i < len; i++) {
        const j = start + i;
        out[i] = j < have && j >= have - cap ? buf[j % cap] : NaN;
      }
      return out;
    });
    return { recon, envelopes, end };
  }

  /** Forgets every sample and filter state, as if just constructed. */
  reset(): void {
    this.rawFilter.reset();
    this.resampler.reset();
    this.envFilter.reset();
    this.lastRaw.fill(0);
    this.lastEnv.fill(0);
    this.feat.fill(0);
    this.recon.fill(0);
    for (const e of this.env) e.fill(0);
    this.envCount.fill(0);
    this.featCount = 0;
    this.reconCount = 0;
  }
}
