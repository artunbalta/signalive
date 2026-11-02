/**
 * Neuro-steered gain control: turning attention decisions into how loud each
 * talker is, as a Markov chain (Geirnaert et al. 2019, "An interpretable
 * performance metric for auditory attention decoding algorithms in a context
 * of neuro-steered gain control").
 *
 * No single decision is trusted. Each one moves the chain one step toward
 * the decoded talker, so a wrong decision costs one step and a run of right
 * ones walks all the way over. With decoder accuracy p > 0.5 the chain
 * drifts toward the attended talker; the number of steps trades how fast it
 * gets there against how much one wrong decision moves the sound.
 *
 * Two talkers: one state s in [-steps, steps], negative toward talker 0 and
 * positive toward talker 1. The favoured talker is boosted and the other
 * attenuated by maxBoostDb * |s| / steps each, so the far ends sit
 * 2 * maxBoostDb apart and s = 0 leaves both untouched.
 *
 * More talkers: a level per talker in [0, steps], all starting at 0; the
 * decided talker rises one step and every other falls one, clamped. Each
 * talker's gain is maxBoostDb * (its level minus the highest other level) /
 * steps, so one talker in the lead is boosted and the rest attenuated by the
 * same amount, as with two, and a talker that is catching up is restored
 * gradually.
 */

export interface GainOptions {
  talkers: number;
  /** Steps from neutral to full boost. */
  steps: number;
  /** Boost of a fully favoured talker, and attenuation of the others, dB. Default 9. */
  maxBoostDb?: number;
}

export class GainController {
  readonly talkers: number;
  readonly steps: number;
  readonly maxBoostDb: number;
  /** Two talkers: the single state s. */
  private s = 0;
  /** More talkers: one level each. */
  private readonly levels: Int32Array;

  constructor(opts: GainOptions) {
    const { talkers, steps } = opts;
    if (!Number.isInteger(talkers) || talkers < 1) throw new RangeError(`gain: talkers must be a positive integer, got ${talkers}`);
    if (!Number.isInteger(steps) || steps < 1) throw new RangeError(`gain: steps must be a positive integer, got ${steps}`);
    const maxBoostDb = opts.maxBoostDb ?? 9;
    if (!(maxBoostDb >= 0)) throw new RangeError(`gain: maxBoostDb must be zero or more, got ${maxBoostDb}`);
    this.talkers = talkers;
    this.steps = steps;
    this.maxBoostDb = maxBoostDb;
    this.levels = new Int32Array(talkers > 2 ? talkers : 0);
  }

  /** One attention decision: talker is the decoded one. */
  update(talker: number): void {
    if (!Number.isInteger(talker) || talker < 0 || talker >= this.talkers) {
      throw new RangeError(`gain: talker ${talker} out of range 0 to ${this.talkers - 1}`);
    }
    if (this.talkers === 2) {
      this.s = talker === 1 ? Math.min(this.s + 1, this.steps) : Math.max(this.s - 1, -this.steps);
    } else if (this.talkers > 2) {
      for (let i = 0; i < this.talkers; i++) {
        this.levels[i] = i === talker ? Math.min(this.levels[i] + 1, this.steps) : Math.max(this.levels[i] - 1, 0);
      }
    }
  }

  /** Gain per talker, dB: positive is boosted, negative attenuated. (+ 0 turns -0 into 0.) */
  gainsDb(): number[] {
    const unit = this.maxBoostDb / this.steps;
    if (this.talkers === 1) return [0];
    if (this.talkers === 2) return [-this.s * unit + 0, this.s * unit + 0];
    const out = new Array<number>(this.talkers);
    for (let i = 0; i < this.talkers; i++) {
      let other = 0;
      for (let j = 0; j < this.talkers; j++) if (j !== i && this.levels[j] > other) other = this.levels[j];
      out[i] = (this.levels[i] - other) * unit + 0;
    }
    return out;
  }

  /** Linear amplitude gain per talker, 10 ^ (dB / 20): what a GainNode takes. */
  gains(): number[] {
    return this.gainsDb().map((db) => 10 ** (db / 20));
  }

  /**
   * Where the chain is: for two talkers the single state s in [-steps, steps],
   * otherwise each talker's level in [0, steps]; [0] for a single talker.
   */
  position(): number[] {
    if (this.talkers === 1) return [0];
    if (this.talkers === 2) return [this.s];
    return Array.from(this.levels);
  }

  /** Back to neutral. */
  reset(): void {
    this.s = 0;
    this.levels.fill(0);
  }
}
