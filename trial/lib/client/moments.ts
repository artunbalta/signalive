"use client";

import { getEngine, peekEngine } from "@/lib/audio/engine";
import { PcmPlayer } from "@/lib/audio/player";
import { resample } from "@/lib/audio/resample";
import { REWIND_BUFFER_SEC } from "@/lib/shared/constants";
import { encodeWav, pcm16BytesToInt16 } from "@/lib/shared/audio/wav";
import {
  MomentContentSchema,
  type Moment,
  type MomentContent,
  type MomentPlace,
  type MomentRequestMeta,
  type MomentTrigger,
} from "@/lib/shared/moments";
import type { Lang } from "@/lib/shared/types";
import { ApiError, apiFetch } from "./api";
import { deviceTimeZone, nowForModel } from "./moments-format";
import { nativeApi } from "./moments-ics";
import { currentPlace } from "./moments-place";
import { momentsStore } from "./moments-store";
import { base64ToBytes, readNdjson } from "./ndjson";
import { getPrefs } from "./prefs";
import { rewind } from "./rewind";
import { createStore } from "./store";

/**
 * Keeping a moment. A clench (or the Keep button, or the J key standing in
 * for it) takes the last seconds Rewind holds in this tab's memory, sends
 * them once to POST /api/moments, and writes what comes back on the device:
 * when, where, what was said, a summary, what to do. The stages show while
 * it works ("Listening back", then "Writing it down"); the spoken
 * confirmation plays in the earbuds when it is on. Nothing is kept anywhere
 * else: the audio leaves this tab once and is not stored, and a failed
 * moment keeps its audio in memory only, for one more try.
 */

export const CAPTURE_LENGTHS = [10, 20, 30] as const;
export const DEFAULT_CAPTURE_SEC = REWIND_BUFFER_SEC;
/** Less than this is not worth asking about. */
const MIN_SEC = 1;
const MAX_IN_FLIGHT = 3;
/** A kept or empty capture stays on screen this long (the toast, the card arriving). */
const LINGER_MS = 6000;
/** How long a capture waits for the place's name before sending without it. */
const PLACE_WAIT_MS = 2500;
/** How long the saved moment waits for its place before it is added later. */
const PLACE_SAVE_WAIT_MS = 8000;

export type CaptureStage = "listening_back" | "writing" | "saved" | "no_speech" | "error";

export interface Capture {
  /** Also the moment's id once kept. */
  id: string;
  trigger: MomentTrigger;
  at: string;
  /** Seconds of audio sent. */
  seconds: number;
  stage: CaptureStage;
  transcript: string | null;
  title: string | null;
  error: string | null;
  /** performance.now() when the stage began. */
  stageAt: number;
}

export type CaptureNotice = "listening_off" | "nothing_kept" | "too_many";

export interface MomentsView {
  /** Newest first. */
  captures: Capture[];
  /** Why the last attempt kept nothing; `at` lets the screens show it briefly. */
  notice: { code: CaptureNotice; at: number } | null;
  /** The moment being read aloud, while it is; with the error when reading failed. */
  reading: { id: string; state: "loading" | "playing" | "error"; error: string | null } | null;
}

interface Pending {
  wav: Blob;
  trigger: MomentTrigger;
  at: string;
  seconds: number;
  place: Promise<(MomentPlace & { named: boolean }) | null>;
}

export function captureSeconds(): number {
  const s = getPrefs().momentSeconds;
  return CAPTURE_LENGTHS.includes(s as (typeof CAPTURE_LENGTHS)[number]) ? (s as number) : DEFAULT_CAPTURE_SEC;
}

const replyLang = (): Lang => (typeof document !== "undefined" && document.documentElement.lang === "tr" ? "tr" : "en");

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

class MomentsController {
  readonly view = createStore<MomentsView>({ captures: [], notice: null, reading: null });

  private readonly pending = new Map<string, Pending>();
  private readonly requests = new Map<string, AbortController>();
  private player: PcmPlayer | null = null;
  private readingRequest: AbortController | null = null;

  /**
   * Keeps the last seconds as a moment. Resolves with the capture's id, or
   * null (and a notice) when nothing could be kept.
   */
  async capture(trigger: MomentTrigger): Promise<string | null> {
    const clip = rewind.latest(captureSeconds());
    if (!clip) return this.notice("listening_off");
    if (clip.samples.length < clip.rate * MIN_SEC) return this.notice("nothing_kept");
    if (this.requests.size >= MAX_IN_FLIGHT) return this.notice("too_many");

    const id = crypto.randomUUID();
    const audio = resample(clip.samples, clip.rate, 16000);
    const seconds = Math.round((audio.length / 16000) * 10) / 10;
    const wav = new Blob([encodeWav(audio, 16000) as BlobPart], { type: "audio/wav" });
    const at = new Date().toISOString();
    const place = getPrefs().momentPlace ? currentPlace(replyLang()).catch(() => null) : Promise.resolve(null);
    this.pending.set(id, { wav, trigger, at, seconds, place });
    this.cue();
    this.view.set((s) => ({
      notice: null,
      captures: [
        { id, trigger, at, seconds, stage: "listening_back", transcript: null, title: null, error: null, stageAt: performance.now() },
        ...s.captures,
      ],
    }));
    void this.run(id);
    return id;
  }

  /** One more try with the same seconds, after a failure. */
  retry(id: string) {
    if (!this.pending.has(id) || this.requests.has(id)) return;
    this.patch(id, { stage: "listening_back", error: null, transcript: null });
    void this.run(id);
  }

  /** Forgets a capture, and its audio. */
  dismiss(id: string) {
    this.requests.get(id)?.abort();
    this.requests.delete(id);
    this.pending.delete(id);
    this.view.set((s) => ({ captures: s.captures.filter((c) => c.id !== id) }));
  }

  dismissNotice() {
    this.view.set({ notice: null });
  }

  /** Stops what is playing: the spoken confirmation, or a moment read aloud. */
  stopSpeaking() {
    this.readingRequest?.abort();
    this.readingRequest = null;
    this.player?.stop();
    if (this.view.get().reading) this.view.set({ reading: null });
  }

  /**
   * Reads a moment aloud through POST /api/speak: its title, its summary and
   * what to do, in the language it was written in. A second press stops it.
   */
  async read(moment: Moment, labels: { actionItems: string }) {
    const playing = this.view.get().reading?.id === moment.id;
    this.stopSpeaking();
    if (playing) return;
    const text = [
      moment.title,
      moment.summary,
      moment.actionItems.length ? `${labels.actionItems}: ${moment.actionItems.map((a) => a.text).join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
    const controller = new AbortController();
    this.readingRequest = controller;
    this.view.set({ reading: { id: moment.id, state: "loading", error: null } });
    const player = this.output();
    player.stop();
    let error: string | null = null;
    try {
      await getEngine().resume();
      const res = await apiFetch("/api/speak", { method: "POST", json: { text, lang: moment.language }, signal: controller.signal });
      await readNdjson(res, (ev) => {
        if (controller.signal.aborted) return;
        if (ev.t === "audio") {
          player.enqueue(pcm16BytesToInt16(base64ToBytes(String(ev.pcm ?? ""))), Number(ev.sr) || 24000);
          if (this.view.get().reading?.state !== "playing") this.view.set({ reading: { id: moment.id, state: "playing", error: null } });
        } else if (ev.t === "error") error ??= String(ev.code ?? "generic");
      });
    } catch (err) {
      if (!controller.signal.aborted) error = err instanceof ApiError ? err.code : "network";
    }
    if (controller.signal.aborted || this.readingRequest !== controller) return;
    this.readingRequest = null;
    const failure = error as string | null;
    if (failure) {
      this.view.set({ reading: { id: moment.id, state: "error", error: failure } });
      return;
    }
    if (!player.playing) {
      this.view.set({ reading: null });
      return;
    }
    const off = player.onEnded(() => {
      off();
      if (this.view.get().reading?.id === moment.id) this.view.set({ reading: null });
    });
  }

  private notice(code: CaptureNotice): null {
    this.view.set({ notice: { code, at: performance.now() } });
    return null;
  }

  private patch(id: string, p: Partial<Capture>) {
    this.view.set((s) => ({
      captures: s.captures.map((c) => (c.id === id ? { ...c, ...p, ...(p.stage && p.stage !== c.stage ? { stageAt: performance.now() } : {}) } : c)),
    }));
  }

  private linger(id: string) {
    setTimeout(() => {
      const c = this.view.get().captures.find((x) => x.id === id);
      if (c && (c.stage === "saved" || c.stage === "no_speech")) {
        this.view.set((s) => ({ captures: s.captures.filter((x) => x.id !== id) }));
      }
    }, LINGER_MS);
  }

  private output(): PcmPlayer {
    this.player ??= new PcmPlayer(getEngine().ctx, getEngine().sources.input("moments"));
    return this.player;
  }

  /**
   * A soft tick in the earbuds the moment the clench is taken, before any
   * words come back, and a light tap of the phone inside the Signalive app.
   */
  private cue() {
    const haptics = nativeApi()?.haptics;
    if (haptics && typeof haptics.impact === "function") void haptics.impact("light").catch(() => undefined);
    if (getPrefs().momentSpeak === false) return;
    const engine = peekEngine();
    if (!engine || engine.ctx.state !== "running") return;
    const ctx = engine.ctx;
    const t0 = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1175, t0);
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.09);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.07, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(env).connect(engine.sources.input("system"));
    osc.start(t0);
    osc.stop(t0 + 0.18);
  }

  private async run(id: string) {
    const job = this.pending.get(id);
    if (!job) return;
    const controller = new AbortController();
    this.requests.set(id, controller);
    const prefs = getPrefs();
    const speak = prefs.momentSpeak !== false;
    const lang = replyLang();

    const early = await within(job.place, PLACE_WAIT_MS);
    const meta: MomentRequestMeta = {
      speechLang: prefs.speechLang ?? "auto",
      replyLang: lang,
      now: nowForModel(lang, new Date(job.at)),
      timeZone: deviceTimeZone(),
      place: early?.named ? early.name.slice(0, 160) : null,
      trigger: job.trigger,
      speak,
    };
    const form = new FormData();
    form.append("meta", JSON.stringify(meta));
    form.append("audio", job.wav, "moment.wav");

    let content: MomentContent | null = null;
    let transcript = "";
    let heard = false;
    let noSpeech = false;
    let error: string | null = null;
    const player = speak ? this.output() : null;
    player?.reset();

    try {
      const res = await apiFetch("/api/moments", { method: "POST", body: form, signal: controller.signal });
      await readNdjson(res, (ev) => {
        if (controller.signal.aborted) return;
        switch (ev.t) {
          case "transcript":
            heard = true;
            transcript = String(ev.text ?? "").trim();
            this.patch(id, { stage: "writing", transcript });
            break;
          case "no_speech":
            noSpeech = true;
            break;
          case "moment": {
            const parsed = MomentContentSchema.safeParse(ev.content);
            if (parsed.success) {
              content = parsed.data;
              this.patch(id, { title: parsed.data.title });
            } else error ??= "invalid_moment";
            break;
          }
          case "audio":
            if (player) player.enqueue(pcm16BytesToInt16(base64ToBytes(String(ev.pcm ?? ""))), Number(ev.sr) || 24000);
            break;
          case "error":
            error ??= String(ev.code ?? "generic");
            break;
        }
      });
    } catch (err) {
      if (!controller.signal.aborted) error = err instanceof ApiError ? err.code : "network";
    } finally {
      this.requests.delete(id);
    }
    if (controller.signal.aborted) return;

    const kept = content as MomentContent | null;
    if (kept) {
      const place = (await within(job.place, PLACE_SAVE_WAIT_MS)) ?? null;
      const moment: Moment = {
        ...kept,
        id,
        createdAt: job.at,
        timeZone: deviceTimeZone(),
        place: place ? { name: place.name, lat: place.lat, lon: place.lon } : null,
        trigger: job.trigger,
        seconds: job.seconds,
        transcript,
        actions: [],
        pinned: false,
      };
      await momentsStore.load();
      await momentsStore.add(moment);
      this.pending.delete(id);
      this.patch(id, { stage: "saved", title: kept.title, error: null });
      this.linger(id);
      // A place still on its way joins the moment when it arrives.
      if (!place && prefs.momentPlace) {
        void job.place.then((p) => p && momentsStore.update(id, (m) => ({ ...m, place: { name: p.name, lat: p.lat, lon: p.lon } })));
      }
      return;
    }
    if (noSpeech || (!error && heard && !transcript)) {
      this.pending.delete(id);
      this.patch(id, { stage: "no_speech" });
      this.linger(id);
      return;
    }
    this.patch(id, { stage: "error", error: error ?? "generic" });
    this.forgetOldFailures();
  }

  /** Failed captures keep their audio for a retry; only the latest few. */
  private forgetOldFailures() {
    const failed = this.view.get().captures.filter((c) => c.stage === "error");
    for (const c of failed.slice(MAX_IN_FLIGHT)) this.dismiss(c.id);
  }
}

export const moments = new MomentsController();
