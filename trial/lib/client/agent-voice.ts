"use client";

import { encodeWav } from "@/lib/shared/audio/wav";
import type { Lang, SpeechLang } from "@/lib/shared/types";
import { apiFetch } from "./api";

/**
 * A question asked by voice in Ask: held on the mic button (it ends when the
 * button is let go) or started by a held clench (it ends by itself, when the
 * wearer stops talking). Either way the words are recognized, then sent to
 * POST /api/agent as text.
 */

export type EndpointEvent = "speech" | "end" | "no_speech" | "max";

export interface EndpointerOptions {
  /** Speech is this far above the quietest recent level... */
  marginDb: number;
  /** ...and above this, whatever the room. */
  minSpeechDb: number;
  /** Voiced time before the question counts as started. */
  startMs: number;
  /** Quiet after speech that ends the question. */
  endSilenceMs: number;
  /** Voiced time a question needs before quiet may end it. */
  minSpeechMs: number;
  /** No speech by then: nothing was asked. */
  noSpeechMs: number;
  /** A question ends here whatever happens. */
  maxMs: number;
}

export const ENDPOINTER_DEFAULTS: EndpointerOptions = {
  marginDb: 10,
  minSpeechDb: -52,
  startMs: 150,
  endSilenceMs: 1100,
  minSpeechMs: 300,
  noSpeechMs: 6000,
  maxMs: 20_000,
};

/**
 * Tells from levels alone when a spoken question started and ended. The
 * room's level is the quietest chunk lately, rising slowly (2 dB a second)
 * so a noise that settles in is not taken for speech for long.
 */
export class Endpointer {
  private readonly o: EndpointerOptions;
  private t = 0;
  private floor: number | null = null;
  private voicedMs = 0;
  private lastVoiceAt = 0;
  private started = false;
  private done = false;

  constructor(opts: Partial<EndpointerOptions> = {}) {
    this.o = { ...ENDPOINTER_DEFAULTS, ...opts };
  }

  get speaking(): boolean {
    return this.started;
  }

  /** One chunk's RMS level (dBFS) and length; returns an event when one happens. */
  push(rmsDb: number, durationMs: number): EndpointEvent | null {
    if (this.done) return null;
    const db = Number.isFinite(rmsDb) ? rmsDb : -120;
    this.t += durationMs;
    if (this.floor === null || db < this.floor) this.floor = db;
    else if (!this.started || this.t - this.lastVoiceAt > 400) this.floor += 0.002 * durationMs;
    const voiced = db > Math.max(this.o.minSpeechDb, this.floor + this.o.marginDb);
    if (voiced) {
      this.voicedMs += durationMs;
      this.lastVoiceAt = this.t;
      if (!this.started && this.voicedMs >= this.o.startMs) {
        this.started = true;
        return "speech";
      }
    } else if (this.started && this.t - this.lastVoiceAt >= this.o.endSilenceMs) {
      this.done = true;
      // Too little voice to be a question: a cough or a knock, not words.
      return this.voicedMs >= this.o.minSpeechMs ? "end" : "no_speech";
    }
    if (!this.started && this.t >= this.o.noSpeechMs) {
      this.done = true;
      return "no_speech";
    }
    if (this.t >= this.o.maxMs) {
      this.done = true;
      return this.started ? "max" : "no_speech";
    }
    return null;
  }
}

/** The shortest audio the recognition route takes. */
const MIN_UPLOAD_SEC = 1;

/**
 * Recognizes a short question without keeping it anywhere: the audio goes
 * to POST /api/stt, which recognizes speech, stores nothing and answers with
 * the words. (Used when the browser cannot stream to the recognizer itself.)
 * Resolves with the words, "" when there were none.
 */
export async function transcribeOnce(
  audio16k: Float32Array,
  opts: { speechLang: SpeechLang; signal?: AbortSignal },
): Promise<{ text: string; language: Lang | null }> {
  // Padded to the route's minimum with silence; a question is never longer than its maximum.
  const min = MIN_UPLOAD_SEC * 16000;
  const samples = audio16k.length >= min ? audio16k : (() => {
    const p = new Float32Array(min);
    p.set(audio16k);
    return p;
  })();
  const clip = samples.subarray(0, Math.min(samples.length, 30 * 16000));
  const form = new FormData();
  form.append("meta", JSON.stringify({ speechLang: opts.speechLang }));
  form.append("audio", new Blob([encodeWav(clip, 16000) as BlobPart], { type: "audio/wav" }), "question.wav");
  const res = await apiFetch("/api/stt", { method: "POST", body: form, signal: opts.signal });
  const body = (await res.json()) as { text?: unknown; language?: unknown };
  const language = body.language === "tr" || body.language === "en" ? body.language : null;
  return { text: typeof body.text === "string" ? body.text.trim() : "", language };
}
