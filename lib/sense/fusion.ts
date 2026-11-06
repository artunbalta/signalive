/**
 * Who is being listened to, from two cues: where the head points and what
 * the EEG decoder says.
 *
 * People mostly face the person they listen to, but not always, so head
 * orientation is a prior: a von Mises bump around the yaw, exp(kappa *
 * cos(yaw - azimuth)), flat when the yaw is unknown. The EEG comes in either
 * as one decision, evidence exp(eegWeight * margin) for the decoded talker,
 * margin being how far its score beat the runner up, or, as the session uses
 * it, as an AttentionBelief built from every decision so far. Their product,
 * normalised, is the posterior over talkers.
 *
 * Defaults:
 * - kappa 2: a talker 90 degrees off is e^-2, about 0.14 times as likely as
 *   one straight ahead, and one 60 degrees off about 0.37 times.
 * - eegWeight 3: what a ten second decision of the linear decoder is worth,
 *   fitted on people it never saw (research/aad/calibrate.py: 2.97). A margin
 *   of 0.1 multiplies the decoded talker's odds by about 1.35; such decisions
 *   were right about 55% of the time. One decision never overturns facing a
 *   talker 60 degrees away; a belief built over a minute can. The learned
 *   decoder's model carries its own weight.
 * - hazard 0.02: the chance per decision that attention moved since the last
 *   one. On the same people (research/aad/belief.py) it turns the linear
 *   decoder's 58% right single decisions into a belief that favours the
 *   followed talker 80% of the time, and comes over to a new one in about 70
 *   seconds.
 */

export const DEFAULT_KAPPA = 2;
export const DEFAULT_EEG_WEIGHT = 3;
export const DEFAULT_HAZARD = 0.02;

export interface FusionInput {
  /** Where each talker stands, degrees, in the same frame as the yaw. */
  azimuthsDeg: number[];
  /** Where the head points, degrees; undefined for no orientation cue. */
  yawDeg?: number;
  /** One decision of the decoder, if any. */
  eeg?: { talker: number; margin: number } | null;
  /** Or the EEG's belief per talker, summing to 1 (AttentionBelief.probabilities); used instead of eeg. */
  belief?: number[] | null;
  /** Concentration of the orientation prior. Default DEFAULT_KAPPA. */
  kappa?: number;
  /** Log odds per unit of margin, for eeg. Default DEFAULT_EEG_WEIGHT. */
  eegWeight?: number;
}

const RAD = Math.PI / 180;

/** Posterior probability per talker, summing to 1; empty for no talkers. */
export function fuseAttention(input: FusionInput): number[] {
  const { azimuthsDeg, yawDeg, belief } = input;
  const eeg = belief ? null : input.eeg;
  const kappa = input.kappa ?? DEFAULT_KAPPA;
  const eegWeight = input.eegWeight ?? DEFAULT_EEG_WEIGHT;
  const n = azimuthsDeg.length;
  if (n === 0) return [];
  if (eeg && (!Number.isInteger(eeg.talker) || eeg.talker < 0 || eeg.talker >= n)) {
    throw new RangeError(`fusion: talker ${eeg.talker} out of range 0 to ${n - 1}`);
  }
  if (belief && belief.length !== n) throw new RangeError(`fusion: a belief over ${belief.length} talkers for ${n}`);
  // Log weights, shifted by their maximum before exp so nothing overflows.
  const logw = azimuthsDeg.map((az, i) => {
    let w = yawDeg === undefined || !Number.isFinite(yawDeg) ? 0 : kappa * Math.cos((yawDeg - az) * RAD);
    if (eeg && i === eeg.talker && Number.isFinite(eeg.margin)) w += eegWeight * eeg.margin;
    if (belief) w += Math.log(Math.max(belief[i], 1e-300));
    return w;
  });
  const top = Math.max(...logw);
  const w = logw.map((l) => Math.exp(l - top));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / total);
}

export interface HeadDwellOptions {
  /** Where each talker stands, degrees, in the same frame as the yaw. */
  azimuthsDeg: number[];
  /** Seconds on one talker for the head prior to reach its full weight. */
  rampS: number;
  /** How far from a talker the head may point and still count as facing them. Default 30. */
  withinDeg?: number;
}

/**
 * How long the head has stayed on one talker, as a weight for its prior.
 *
 * fuseAttention's head prior acts at once, so a glance at another talker
 * outweighs any but a very sure belief. A listener who follows one person
 * also looks at the others at the table. research/aad/hold_value.py replayed
 * real held out decisions under a head that looked away a quarter of the
 * time, half of it at the other talker: the followed voice was forward 88% of
 * the time with the instant prior and 92% with one that grows from nothing to
 * its full weight over the first 40 s on a talker, which lets the belief hold
 * through glances, at the price of about 20 s to follow a real turn. Facing no
 * talker, the prior has no weight and the belief decides. Off unless a
 * session asks for it (SessionOptions.headDwellS).
 */
export class HeadDwell {
  readonly rampMs: number;
  readonly withinDeg: number;
  private readonly az: number[];
  private target = -1;
  private since = 0;

  constructor(opts: HeadDwellOptions) {
    if (!(opts.rampS > 0) || !Number.isFinite(opts.rampS)) throw new RangeError(`fusion: rampS must be a positive number, got ${opts.rampS}`);
    this.rampMs = opts.rampS * 1000;
    this.withinDeg = opts.withinDeg ?? 30;
    this.az = [...opts.azimuthsDeg];
  }

  /** The head's yaw at nowMs, null when it is not known. */
  update(yawDeg: number | null | undefined, nowMs: number): void {
    let t = -1;
    if (yawDeg != null && Number.isFinite(yawDeg)) {
      let best = Infinity;
      this.az.forEach((a, i) => {
        const d = Math.abs(((((yawDeg - a + 180) % 360) + 360) % 360) - 180);
        if (d <= this.withinDeg && d < best) {
          best = d;
          t = i;
        }
      });
    }
    if (t !== this.target) {
      this.target = t;
      this.since = nowMs;
    }
  }

  /** The talker faced, or -1 for none. */
  get faced(): number {
    return this.target;
  }

  /** From 0, on arriving at a talker or facing none, to 1 after rampS on one. */
  scale(nowMs: number): number {
    if (this.target < 0) return 0;
    return Math.min(1, Math.max(0, (nowMs - this.since) / this.rampMs));
  }
}

export interface BeliefOptions {
  talkers: number;
  /** Log odds per unit of margin a decision is worth. Default DEFAULT_EEG_WEIGHT. */
  weight?: number;
  /** Chance per decision that attention moved since the last one. Default DEFAULT_HAZARD. */
  hazard?: number;
}

/**
 * The EEG's running belief about who is being listened to: a hidden Markov
 * model over talkers, filtered forward one decision at a time. Before each
 * decision attention may have moved, with chance hazard, to any other talker
 * alike; the decision then multiplies its talker's odds by exp(weight *
 * margin). Feed it decisions over windows that do not overlap, so each one
 * is fresh evidence. With two talkers this is research/aad/belief.py's
 * follow(), number for number.
 */
export class AttentionBelief {
  readonly talkers: number;
  readonly weight: number;
  readonly hazard: number;
  private readonly p: Float64Array;
  private n = 0;

  constructor(opts: BeliefOptions) {
    const { talkers } = opts;
    if (!Number.isInteger(talkers) || talkers < 1) throw new RangeError(`fusion: talkers must be a positive integer, got ${talkers}`);
    const weight = opts.weight ?? DEFAULT_EEG_WEIGHT;
    const hazard = opts.hazard ?? DEFAULT_HAZARD;
    if (!(weight >= 0) || !Number.isFinite(weight)) throw new RangeError(`fusion: weight must be zero or more, got ${weight}`);
    if (!(hazard >= 0 && hazard <= 1)) throw new RangeError(`fusion: hazard must be between 0 and 1, got ${hazard}`);
    this.talkers = talkers;
    this.weight = weight;
    this.hazard = hazard;
    this.p = new Float64Array(talkers).fill(1 / talkers);
  }

  /** One decision. A margin that is not a finite number is no evidence, but time still passes. */
  update(decision: { talker: number; margin: number }): void {
    const { talker, margin } = decision;
    if (!Number.isInteger(talker) || talker < 0 || talker >= this.talkers) {
      throw new RangeError(`fusion: talker ${talker} out of range 0 to ${this.talkers - 1}`);
    }
    const K = this.talkers;
    const p = this.p;
    if (K > 1) {
      const h = this.hazard;
      for (let k = 0; k < K; k++) p[k] = (1 - h) * p[k] + (h * (1 - p[k])) / (K - 1);
    }
    if (Number.isFinite(margin)) {
      p[talker] *= Math.exp(this.weight * margin);
      let total = 0;
      for (let k = 0; k < K; k++) total += p[k];
      for (let k = 0; k < K; k++) p[k] /= total;
    }
    this.n++;
  }

  /** Probability per talker, summing to 1. */
  get probabilities(): number[] {
    return Array.from(this.p);
  }

  /** Decisions taken so far. */
  get decisions(): number {
    return this.n;
  }

  /** Back to even, as if just constructed. */
  reset(): void {
    this.p.fill(1 / this.talkers);
    this.n = 0;
  }
}
