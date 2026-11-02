/**
 * Jaw clench detection from the ear electrodes: the silent command.
 *
 * A clench fires the jaw muscles, which puts broadband muscle activity (EMG)
 * on every ear electrode, far above the EEG in the 30 to 120 Hz band. Per
 * side, the band passed power is averaged over that side's electrodes and
 * smoothed into a 50 ms RMS, which is compared with that side's adaptive
 * noise floor. A burst needs BOTH sides above k times their floor for 40 ms:
 * a real clench uses the jaw muscles on both sides, so a one sided spike,
 * such as a finger touching one earbud, is not a clench. A burst ends when
 * both sides are back under twice their floor.
 *
 * Bursts become gestures. A burst still going 700 ms after its onset is a
 * hold, reported right then. Two bursts of at most 450 ms, the second
 * starting within 450 ms of the first one's end, are a double. Anything else
 * is a single, reported once a second burst can no longer arrive in time.
 * Four bursts within 3 s is chewing, which silences everything for 2 s.
 *
 * The 50 ms RMS window trails the signal, so when a burst is seen to end the
 * window has just emptied: the burst is dated as ending one window earlier.
 * That keeps burst lengths and gaps close to what the jaw did, and a single
 * reported about 650 ms after a 200 ms clench begins.
 */
import { butterBandpass, SosFilter } from "./dsp";

export type ClenchEvent = {
  kind: "single" | "double" | "hold";
  /** Onset of the gesture's first burst, in seconds since the first frame. */
  time: number;
  /** Peak RMS over the noise floor during the gesture, on the weaker side. */
  strength: number;
};

export interface ClenchOptions {
  /** Frame rate, Hz. At least 250 Hz, so most of the muscle band lies below Nyquist. */
  fs: number;
  /** Indexes of the left ear electrodes in each frame. */
  left: number[];
  /** Indexes of the right ear electrodes in each frame. */
  right: number[];
  /** Muscle band, Hz. Default [30, 120], the top clamped to 0.9 times Nyquist. */
  band?: [number, number];
  /** A burst needs both sides above k times their floor. Default 4. */
  k?: number;
}

/** The top of the muscle band stays below this share of Nyquist. */
const NYQUIST_SHARE = 0.9;
/** RMS window. */
const RMS_S = 0.05;
/** Both sides above threshold this long before a burst counts. */
const ONSET_S = 0.04;
/** A burst ends when both sides fall under this multiple of their floor. */
const RELEASE = 2;
/** No new burst may start this soon after one ends. */
const REFRACTORY_S = 0.15;
/** A burst lasting this long is a hold. */
const HOLD_S = 0.7;
/** Longest burst in a double, and longest gap between its two bursts. */
const DOUBLE_S = 0.45;
/** This many bursts within CHEW_S is chewing, not a command. */
const CHEW_BURSTS = 4;
const CHEW_S = 3;
/** How long chewing silences events. */
const CHEW_QUIET_S = 2;
/** The floor starts as the median RMS over this span of the first second... */
const FLOOR_FROM_S = 0.2;
const FLOOR_TO_S = 1;
/** ...then follows the background with this time constant, while idle. */
const FLOOR_TAU_S = 5;
/** Microvolts. Below any real amplifier noise; keeps a flat line from dividing by zero. */
const FLOOR_MIN = 0.1;
/** After this long in one burst, the floor follows anyway: a step in background level, not a clench. */
const STUCK_S = 10;

const IDLE = 0;
const CANDIDATE = 1;
const ACTIVE = 2;

export class ClenchDetector {
  readonly fs: number;
  readonly k: number;
  /** The muscle band actually used, after clamping. */
  readonly band: [number, number];

  private readonly left: Int32Array;
  private readonly right: Int32Array;
  private readonly filter: SosFilter;
  /** Last finite sample per electrode (left then right), standing in for dropped ones. */
  private readonly last: Float64Array;

  // Samples, from the constants above.
  private readonly win: number;
  private readonly onsetLen: number;
  private readonly refractoryLen: number;
  private readonly holdLen: number;
  private readonly doubleLen: number;
  private readonly chewLen: number;
  private readonly quietLen: number;
  private readonly floorFrom: number;
  private readonly floorTo: number;
  private readonly stuckLen: number;
  private readonly alpha: number;

  // 50 ms moving average of per side power.
  private readonly ringL: Float64Array;
  private readonly ringR: Float64Array;
  private ringPos = 0;
  private sumL = 0;
  private sumR = 0;
  private rmsL = 0;
  private rmsR = 0;

  // Noise floors.
  private readonly initL: Float64Array;
  private readonly initR: Float64Array;
  private floorL = FLOOR_MIN;
  private floorR = FLOOR_MIN;
  private floorReady = false;

  /** Frames pushed so far; the current frame's index during push. */
  private n = 0;
  private phase = IDLE;
  private runStart = 0;
  private runPeak = 0;
  private refractoryUntil = 0;

  // The burst in progress.
  private onset = 0;
  private peak = 0;
  private paired = false;
  private silenced = false;
  private held = false;

  // A finished short burst waiting to see whether a second one follows.
  private pendingOnset = -1;
  private pendingEnd = 0;
  private pendingPeak = 0;

  // Chewing: onsets of the last CHEW_BURSTS - 1 bursts.
  private readonly onsets: Float64Array;
  private onsetCount = 0;
  private onsetPos = 0;
  private quietUntil = 0;

  private readonly queue: ClenchEvent[] = [];

  constructor(opts: ClenchOptions) {
    const { fs } = opts;
    if (!(fs > 0)) throw new RangeError(`clench: fs must be positive, got ${fs}`);
    if (opts.left.length === 0 || opts.right.length === 0) throw new RangeError("clench: needs at least one electrode per side");
    for (const i of [...opts.left, ...opts.right]) {
      if (!Number.isInteger(i) || i < 0) throw new RangeError(`clench: electrode index ${i} is not a frame index`);
    }
    const k = opts.k ?? 4;
    if (!(k > RELEASE)) throw new RangeError(`clench: k must exceed the release level ${RELEASE}, got ${k}`);
    const [lo, hiWanted] = opts.band ?? [30, 120];
    // An edge much closer to Nyquist rings for tens of ms after a burst
    // (45 ms for 120 Hz at 250 Hz), which would delay seeing it end.
    const hi = Math.min(hiWanted, NYQUIST_SHARE * (fs / 2));
    if (!(lo > 0 && lo < hi)) throw new RangeError(`clench: band [${lo}, ${hiWanted}] Hz does not fit below Nyquist at ${fs} Hz`);

    this.fs = fs;
    this.k = k;
    this.band = [lo, hi];
    this.left = Int32Array.from(opts.left);
    this.right = Int32Array.from(opts.right);
    this.filter = new SosFilter(butterBandpass(2, [lo, hi], fs), this.left.length + this.right.length);
    this.last = new Float64Array(this.left.length + this.right.length);

    const samples = (s: number) => Math.max(1, Math.round(s * fs));
    this.win = samples(RMS_S);
    this.onsetLen = samples(ONSET_S);
    this.refractoryLen = samples(REFRACTORY_S);
    this.holdLen = samples(HOLD_S);
    this.doubleLen = samples(DOUBLE_S);
    this.chewLen = samples(CHEW_S);
    this.quietLen = samples(CHEW_QUIET_S);
    this.floorFrom = Math.floor(FLOOR_FROM_S * fs);
    this.floorTo = Math.max(this.floorFrom + 1, Math.round(FLOOR_TO_S * fs));
    this.stuckLen = samples(STUCK_S);
    this.alpha = 1 / (FLOOR_TAU_S * fs);

    this.ringL = new Float64Array(this.win);
    this.ringR = new Float64Array(this.win);
    this.initL = new Float64Array(this.floorTo - this.floorFrom);
    this.initR = new Float64Array(this.floorTo - this.floorFrom);
    this.onsets = new Float64Array(CHEW_BURSTS - 1);
  }

  /** True once the first second has set the noise floors; nothing is detected before. */
  get ready(): boolean {
    return this.floorReady;
  }

  /** Current RMS over the noise floor, left and right; zeros until ready. */
  get levels(): [number, number] {
    return this.floorReady ? [this.rmsL / this.floorL, this.rmsR / this.floorR] : [0, 0];
  }

  /**
   * One frame of raw samples in microvolts, every channel of the device;
   * only the left and right indexes are read. Returns at most one event; a
   * sample that is not finite repeats that electrode's last good value.
   */
  push(frame: ArrayLike<number>): ClenchEvent | null {
    const n = this.n++;
    this.measure(frame);

    if (!this.floorReady) {
      if (n >= this.floorFrom) {
        this.initL[n - this.floorFrom] = this.rmsL;
        this.initR[n - this.floorFrom] = this.rmsR;
      }
      if (n === this.floorTo - 1) {
        this.floorL = Math.max(FLOOR_MIN, median(this.initL));
        this.floorR = Math.max(FLOOR_MIN, median(this.initR));
        this.floorReady = true;
      }
      return null;
    }

    const rl = this.rmsL / this.floorL;
    const rr = this.rmsR / this.floorR;
    const ratio = Math.min(rl, rr);
    const above = ratio > this.k;

    if (this.phase === ACTIVE) {
      if (rl < RELEASE && rr < RELEASE) {
        this.phase = IDLE;
        this.refractoryUntil = n + this.refractoryLen;
        this.endBurst(n);
      } else {
        if (ratio > this.peak) this.peak = ratio;
        this.whileActive(n);
        if (n - this.onset >= this.stuckLen) this.track();
      }
    } else {
      if (this.phase === IDLE && above && n >= this.refractoryUntil) {
        this.phase = CANDIDATE;
        this.runStart = n;
        this.runPeak = ratio;
      } else if (this.phase === CANDIDATE && !above) {
        this.phase = IDLE;
      }
      if (this.phase === CANDIDATE) {
        if (ratio > this.runPeak) this.runPeak = ratio;
        if (n - this.runStart + 1 >= this.onsetLen) this.startBurst(n);
      }
      if (this.phase === IDLE && n >= this.refractoryUntil) this.track();
    }

    // A waiting single is final once no second burst can start in time; a
    // run that began before the deadline may still become one, so wait it out.
    if (this.pendingOnset >= 0 && this.phase !== ACTIVE) {
      const deadline = this.pendingEnd + this.doubleLen;
      if (n >= deadline && !(this.phase === CANDIDATE && this.runStart <= deadline)) this.flushPending();
    }

    return this.queue.shift() ?? null;
  }

  /** Band pass, square, mean per side, then the 50 ms RMS. */
  private measure(frame: ArrayLike<number>): void {
    const last = this.last;
    const nl = this.left.length;
    let pl = 0;
    for (let j = 0; j < nl; j++) {
      const x = frame[this.left[j]];
      if (Number.isFinite(x)) last[j] = x;
      const y = this.filter.step(j, last[j]);
      pl += y * y;
    }
    pl /= nl;
    let pr = 0;
    for (let j = 0; j < this.right.length; j++) {
      const x = frame[this.right[j]];
      if (Number.isFinite(x)) last[nl + j] = x;
      const y = this.filter.step(nl + j, last[nl + j]);
      pr += y * y;
    }
    pr /= this.right.length;

    const pos = this.ringPos;
    this.sumL += pl - this.ringL[pos];
    this.sumR += pr - this.ringR[pos];
    this.ringL[pos] = pl;
    this.ringR[pos] = pr;
    if (++this.ringPos === this.win) {
      // Once per window, sum afresh so rounding never accumulates.
      this.ringPos = 0;
      let sl = 0;
      let sr = 0;
      for (let i = 0; i < this.win; i++) {
        sl += this.ringL[i];
        sr += this.ringR[i];
      }
      this.sumL = sl;
      this.sumR = sr;
    }
    this.rmsL = Math.sqrt(Math.max(0, this.sumL / this.win));
    this.rmsR = Math.sqrt(Math.max(0, this.sumR / this.win));
  }

  /**
   * Floors follow the background slowly. The input is capped at the release
   * level, so a burst that slips through moves them by a few percent at most,
   * while a real rise in background still lifts them within seconds.
   */
  private track(): void {
    const a = this.alpha;
    this.floorL = Math.max(FLOOR_MIN, this.floorL + a * (Math.min(this.rmsL, RELEASE * this.floorL) - this.floorL));
    this.floorR = Math.max(FLOOR_MIN, this.floorR + a * (Math.min(this.rmsR, RELEASE * this.floorR) - this.floorR));
  }

  /** Both sides have been above threshold for 40 ms: a burst began at runStart. */
  private startBurst(n: number): void {
    const onset = this.runStart;
    this.phase = ACTIVE;
    this.onset = onset;
    this.peak = this.runPeak;
    this.held = false;
    this.paired = false;

    // The oldest of the previous three onsets, against this one.
    const chewing = this.onsetCount >= CHEW_BURSTS - 1 && onset - this.onsets[this.onsetPos] <= this.chewLen;
    this.onsets[this.onsetPos] = onset;
    this.onsetPos = (this.onsetPos + 1) % this.onsets.length;
    this.onsetCount++;
    if (chewing) {
      this.quietUntil = n + this.quietLen;
      this.pendingOnset = -1;
    }
    this.silenced = n < this.quietUntil;
    if (this.silenced || this.pendingOnset < 0) return;
    if (onset - this.pendingEnd <= this.doubleLen) this.paired = true;
    else this.flushPending();
  }

  private whileActive(n: number): void {
    if (this.silenced) return;
    // Ending now at the earliest, this burst would already be too long for a double.
    if (this.paired && n + 1 - this.win - this.onset > this.doubleLen) {
      this.paired = false;
      this.flushPending();
    }
    if (!this.held && n - this.onset >= this.holdLen) {
      this.held = true;
      this.emit("hold", this.onset, this.peak);
    }
  }

  /** Both sides fell under the release level at n; the burst itself ended about a window earlier. */
  private endBurst(n: number): void {
    if (this.silenced || this.held) return;
    const end = Math.max(this.onset, n - this.win);
    const short = end - this.onset <= this.doubleLen;
    if (this.paired) {
      this.paired = false;
      if (short) {
        this.emit("double", this.pendingOnset, Math.max(this.pendingPeak, this.peak));
        this.pendingOnset = -1;
        return;
      }
      this.flushPending();
    }
    if (short) {
      this.pendingOnset = this.onset;
      this.pendingEnd = end;
      this.pendingPeak = this.peak;
    } else {
      this.emit("single", this.onset, this.peak);
    }
  }

  private flushPending(): void {
    if (this.pendingOnset < 0) return;
    this.emit("single", this.pendingOnset, this.pendingPeak);
    this.pendingOnset = -1;
  }

  private emit(kind: ClenchEvent["kind"], onset: number, strength: number): void {
    this.queue.push({ kind, time: onset / this.fs, strength });
  }

  /** Forgets everything, floors included: the next second sets them again. */
  reset(): void {
    this.filter.reset();
    this.last.fill(0);
    this.ringL.fill(0);
    this.ringR.fill(0);
    this.ringPos = 0;
    this.sumL = 0;
    this.sumR = 0;
    this.rmsL = 0;
    this.rmsR = 0;
    this.floorL = FLOOR_MIN;
    this.floorR = FLOOR_MIN;
    this.floorReady = false;
    this.n = 0;
    this.phase = IDLE;
    this.refractoryUntil = 0;
    this.paired = false;
    this.silenced = false;
    this.held = false;
    this.pendingOnset = -1;
    this.onsetCount = 0;
    this.onsetPos = 0;
    this.quietUntil = 0;
    this.queue.length = 0;
  }
}

/** Median of a buffer, sorting it in place. Runs once, when the floors are set. */
function median(x: Float64Array): number {
  x.sort();
  const m = x.length >> 1;
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
}
