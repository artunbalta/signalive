/**
 * Turns per-frame speech probabilities into utterances. Pure: the model runs
 * elsewhere (vad.ts), so this can be tested with synthetic probabilities.
 *
 * Hysteresis: a frame at or above positiveThreshold is speech; once speaking,
 * only frames below negativeThreshold count toward the end. The utterance
 * ends after redemptionMs of such frames. Fewer than minSpeechMs of speech is
 * a misfire (a cough, a click). preSpeechPadMs of audio before the first
 * speech frame is kept, so the first syllable is never cut. maxSpeechMs
 * forces a cut in long monologues (the recorder's segment limit).
 */

export interface VadOptions {
  positiveThreshold: number;
  negativeThreshold: number;
  redemptionMs: number;
  minSpeechMs: number;
  preSpeechPadMs: number;
  maxSpeechMs: number;
  /** Duration of one frame: 512 samples at 16 kHz is 32 ms. */
  frameMs: number;
}

export const VAD_NORMAL: VadOptions = {
  positiveThreshold: 0.5,
  negativeThreshold: 0.35,
  redemptionMs: 600,
  minSpeechMs: 250,
  preSpeechPadMs: 320,
  maxSpeechMs: 30_000,
  frameMs: 32,
};

/** Whispers score lower and pause more, so the thresholds drop and the wait grows. */
export const VAD_WHISPER: VadOptions = {
  ...VAD_NORMAL,
  positiveThreshold: 0.3,
  negativeThreshold: 0.2,
  redemptionMs: 800,
  minSpeechMs: 200,
};

export type VadEvent =
  | { type: "start"; at: number; preroll: Float32Array }
  | { type: "confirmed"; at: number }
  | { type: "end"; at: number; audio: Float32Array; lastSpeechAt: number; speechMs: number; forced: boolean }
  | { type: "misfire"; at: number };

function concat(frames: Float32Array[]): Float32Array {
  let n = 0;
  for (const f of frames) n += f.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out;
}

export class VadSegmenter {
  private opts: VadOptions;
  private pad: Float32Array[] = [];
  private segment: Float32Array[] = [];
  private speaking = false;
  private speechFrames = 0;
  private quietFrames = 0;
  private confirmed = false;
  private lastSpeechAt = 0;

  constructor(opts: VadOptions = VAD_NORMAL) {
    this.opts = opts;
  }

  setOptions(patch: Partial<VadOptions>) {
    this.opts = { ...this.opts, ...patch };
  }

  get options(): VadOptions {
    return this.opts;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  private frames(ms: number) {
    return Math.max(1, Math.round(ms / this.opts.frameMs));
  }

  reset() {
    this.pad = [];
    this.segment = [];
    this.speaking = false;
    this.speechFrames = 0;
    this.quietFrames = 0;
    this.confirmed = false;
  }

  /** at: time of the end of this frame, in ms on any monotonic clock. */
  push(frame: Float32Array, prob: number, at: number): VadEvent[] {
    const out: VadEvent[] = [];
    const isSpeech = prob >= this.opts.positiveThreshold;

    if (!this.speaking) {
      if (isSpeech) {
        this.speaking = true;
        this.segment = [...this.pad, frame];
        this.speechFrames = 1;
        this.quietFrames = 0;
        this.confirmed = false;
        this.lastSpeechAt = at;
        out.push({ type: "start", at, preroll: concat(this.pad) });
        this.pad = [];
        if (this.frames(this.opts.minSpeechMs) <= 1) {
          this.confirmed = true;
          out.push({ type: "confirmed", at });
        }
      } else {
        this.pad.push(frame);
        const keep = this.frames(this.opts.preSpeechPadMs);
        while (this.pad.length > keep) this.pad.shift();
      }
      return out;
    }

    this.segment.push(frame);
    if (isSpeech) {
      this.speechFrames++;
      this.quietFrames = 0;
      this.lastSpeechAt = at;
      if (!this.confirmed && this.speechFrames >= this.frames(this.opts.minSpeechMs)) {
        this.confirmed = true;
        out.push({ type: "confirmed", at });
      }
    } else if (prob < this.opts.negativeThreshold) {
      this.quietFrames++;
    }

    const segmentMs = this.segment.length * this.opts.frameMs;
    const ended = this.quietFrames >= this.frames(this.opts.redemptionMs);
    const forced = !ended && segmentMs >= this.opts.maxSpeechMs;
    if (ended || forced) {
      const speechMs = this.speechFrames * this.opts.frameMs;
      if (this.speechFrames >= this.frames(this.opts.minSpeechMs)) {
        out.push({ type: "end", at, audio: concat(this.segment), lastSpeechAt: this.lastSpeechAt, speechMs, forced });
      } else {
        out.push({ type: "misfire", at });
      }
      this.reset();
      // A forced cut usually lands mid speech: keep listening seamlessly.
      if (forced && isSpeech) {
        this.speaking = true;
        this.segment = [];
        this.speechFrames = 0;
        this.lastSpeechAt = at;
        this.confirmed = true;
      }
    }
    return out;
  }
}
