"use client";

import { getEngine, peekEngine } from "@/lib/audio/engine";
import { PcmPlayer } from "@/lib/audio/player";
import { nullAttentionProvider, type AttentionSignalProvider } from "@/lib/extensions/attention-provider";
import { claimGesture } from "@/lib/gestures/claims";
import { pcm16BytesToInt16 } from "@/lib/shared/audio/wav";
import {
  facedSpeaker,
  FOCUS_CUT_DB,
  FOCUS_NEUTRAL_DB,
  FOCUS_RECAP_SEC,
  FOCUS_SPEAKERS,
  loopTail,
  startAfterPause,
} from "@/lib/shared/focus";
import type { Lang } from "@/lib/shared/types";
import { apiFetch, ApiError } from "./api";
import { assistant } from "./assistant";
import { headTracker } from "./head-tracker";
import { MIN_RECAP_SEC, requestRecap } from "./recap";
import { createStore } from "./store";

/**
 * Focus: three people talking at once around the listener. Each voice is a
 * separate recording placed in a virtual room (HRTF panning), the room's
 * listener turns with the head, and the voice the head faces comes forward
 * through the attention extension point: this file's provider reports it,
 * and SourceStage.applyAttention() sets the levels, the same path an
 * in-ear attention decoder would drive. A jaw clench locks onto the voice
 * you face; "what did they say?" recaps any voice's last 15 seconds.
 */

export interface FocusRecap {
  speaker: number;
  transcript: string | null;
  text: string;
  thinking: boolean;
  speaking: boolean;
  error: string | null;
}

export interface FocusView {
  phase: "off" | "loading" | "playing";
  /** Voices ready while loading. */
  loaded: number;
  error: string | null;
  /** The voice that is forward now: the locked one, else the one faced. */
  attended: number | null;
  locked: number | null;
  /** Each voice's level, dB, refreshed a few times a second. */
  gainsDb: number[];
  recap: FocusRecap | null;
}

const IDS = FOCUS_SPEAKERS.map((s) => s.sourceId);
/** Metres from the listener to each speaker in the virtual room. */
const DISTANCE = 1.6;
/** Everyone steps back while a recap speaks. */
const DUCK_DB = -22;
const MIN_CONFIDENCE = 0.5;

interface Voice {
  lang: Lang;
  samples: Float32Array<ArrayBuffer>;
  rate: number;
}

function setListenerYaw(ctx: AudioContext, deg: number) {
  const r = (deg * Math.PI) / 180;
  const fx = Math.sin(r);
  const fz = -Math.cos(r);
  const l = ctx.listener;
  if (l.forwardX) {
    l.forwardX.value = fx;
    l.forwardY.value = 0;
    l.forwardZ.value = fz;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  } else {
    (l as AudioListener & { setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void }).setOrientation(fx, 0, fz, 0, 1, 0);
  }
}

class FocusController {
  readonly view = createStore<FocusView>({
    phase: "off",
    loaded: 0,
    error: null,
    attended: null,
    locked: null,
    gainsDb: FOCUS_SPEAKERS.map(() => -Infinity),
    recap: null,
  });

  private voices: Voice[] = [];
  private loading: { lang: Lang; voices: Promise<Voice[]> } | null = null;
  private nodes: { src: AudioBufferSourceNode; analyser: AnalyserNode; panner: PannerNode }[] = [];
  private startedAt = 0;
  private offsets: number[] = [];
  private lang: Lang = "en";
  private raf = 0;
  private last = 0;
  private lastMeter = 0;
  private applied: string | null | undefined = undefined;
  private ducked = false;
  private releaseClench: (() => void) | null = null;
  private recapRun = 0;
  private recapRequest: AbortController | null = null;
  private recapPlayer: PcmPlayer | null = null;
  private levelData: Float32Array<ArrayBuffer> | null = null;

  /** The attention signal: the locked voice, else the one the head is turned to. */
  readonly attention: AttentionSignalProvider = {
    id: "head-direction",
    currentAttendedSource: () => {
      const { locked } = this.view.get();
      if (locked !== null) return { sourceId: IDS[locked]!, confidence: 1 };
      const faced = facedSpeaker(headTracker.angle);
      return faced ? { sourceId: IDS[faced.index]!, confidence: faced.confidence } : null;
    },
  };

  /**
   * Fetches the three voices for a language, once; the screen calls this as
   * it opens, so Start does not wait. A failed load is forgotten, to retry.
   */
  preload(lang: Lang): Promise<Voice[]> {
    if (this.loading?.lang === lang) return this.loading.voices;
    let loaded = 0;
    const voices = Promise.all(
      FOCUS_SPEAKERS.map(async (_, i) => {
        const res = await apiFetch(`/api/focus/voice?i=${i}&lang=${lang}`);
        const rate = Number(res.headers.get("X-Sample-Rate")) || 24000;
        const pcm = pcm16BytesToInt16(new Uint8Array(await res.arrayBuffer()));
        const samples = new Float32Array(Math.max(1, pcm.length));
        for (let k = 0; k < pcm.length; k++) samples[k] = pcm[k]! / 0x8000;
        this.view.set({ loaded: ++loaded });
        return { lang, samples, rate };
      }),
    );
    this.loading = { lang, voices };
    voices.catch(() => {
      if (this.loading?.voices === voices) this.loading = null;
    });
    return voices;
  }

  /** Starts the room with the voices for a language. Call from a tap. */
  async start(lang: Lang) {
    if (this.view.get().phase !== "off") return;
    this.view.set({ phase: "loading", error: null, recap: null, locked: null, attended: null });
    try {
      await getEngine().resume();
      this.voices = await this.preload(lang);
      if (this.view.get().phase !== "loading") return;
      this.lang = lang;
      assistant.stopSpeaking();
      this.play();
    } catch (err) {
      this.view.set({ phase: "off", error: err instanceof ApiError ? err.code : "network" });
    }
  }

  private play() {
    const engine = getEngine();
    const ctx = engine.ctx;
    engine.sources.setAttentionProvider(this.attention);
    for (const id of IDS) engine.sources.setGain(id, 10 ** (FOCUS_NEUTRAL_DB / 20), 0.05);
    const t0 = ctx.currentTime + 0.12;
    this.startedAt = t0;
    this.nodes = this.voices.map((v, i) => {
      const speaker = FOCUS_SPEAKERS[i]!;
      const buffer = ctx.createBuffer(1, v.samples.length, v.rate);
      buffer.copyToChannel(v.samples, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const panner = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 1, rolloffFactor: 0.5 });
      const a = (speaker.azimuth * Math.PI) / 180;
      panner.positionX.value = Math.sin(a) * DISTANCE;
      panner.positionY.value = 0;
      panner.positionZ.value = -Math.cos(a) * DISTANCE;
      src.connect(analyser);
      src.connect(panner).connect(engine.sources.input(speaker.sourceId));
      // Staggered, so the three loops never line up.
      this.offsets[i] = (buffer.duration * i) / FOCUS_SPEAKERS.length;
      src.start(t0, this.offsets[i]);
      return { src, analyser, panner };
    });
    this.applied = undefined;
    this.releaseClench = claimGesture("jaw_clench", "lock_focus");
    this.view.set({ phase: "playing" });
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const angle = headTracker.tick(dt);
    const engine = getEngine();
    // The listener turns with the head; the voices stay where they are.
    setListenerYaw(engine.ctx, angle);
    if (!this.ducked) {
      const att = this.attention.currentAttendedSource();
      const id = att && att.confidence >= MIN_CONFIDENCE ? att.sourceId : null;
      if (id !== this.applied) {
        this.applied = id;
        engine.sources.applyAttention({ among: IDS, boostDb: 0, cutDb: FOCUS_CUT_DB, minConfidence: MIN_CONFIDENCE, neutralDb: FOCUS_NEUTRAL_DB });
        this.view.set({ attended: id ? IDS.indexOf(id) : null });
      }
    }
    if (now - this.lastMeter > 120) {
      this.lastMeter = now;
      this.view.set({ gainsDb: IDS.map((id) => Math.round(20 * Math.log10(Math.max(1e-6, engine.sources.input(id).gain.value)))) });
    }
  }

  /** The jaw clench: lock onto the voice you face, or let go. */
  toggleLock() {
    const v = this.view.get();
    if (v.phase !== "playing") return;
    if (v.locked !== null) {
      this.view.set({ locked: null, error: null });
    } else {
      const faced = facedSpeaker(headTracker.angle);
      if (!faced) {
        this.view.set({ error: "focus_nobody" });
        return;
      }
      this.view.set({ locked: faced.index, error: null });
    }
    this.applied = undefined;
  }

  /** Turns toward a speaker, for the pointer and the buttons. */
  face(i: number) {
    const s = FOCUS_SPEAKERS[i];
    if (s) headTracker.setAngle(s.azimuth);
  }

  /** 0..1, how loud a voice is right now (before the attention gain), for the figures. */
  level(i: number): number {
    const n = this.nodes[i];
    if (!n) return 0;
    this.levelData ??= new Float32Array(n.analyser.fftSize);
    n.analyser.getFloatTimeDomainData(this.levelData);
    let sum = 0;
    for (const s of this.levelData) sum += s * s;
    const db = 10 * Math.log10(sum / this.levelData.length + 1e-12);
    return Math.min(1, Math.max(0, (db + 50) / 35));
  }

  /** What did they say: the speaker's last seconds, recognized and recapped, while the room steps back. */
  async recap(i: number) {
    const v = this.voices[i];
    if (this.view.get().phase !== "playing" || !v) return;
    const ctx = getEngine().ctx;
    const heard = Math.max(0, (ctx.currentTime - this.startedAt) * v.rate);
    const at = heard + this.offsets[i]! * v.rate;
    const from = startAfterPause(v.samples, at - Math.min(FOCUS_RECAP_SEC * v.rate, heard), v.rate, { earliest: at - heard });
    const clip = loopTail(v.samples, at, at - from);
    if (clip.length < MIN_RECAP_SEC * v.rate) {
      this.view.set({ error: "rewind_empty" });
      return;
    }
    const run = ++this.recapRun;
    this.recapRequest?.abort();
    const request = new AbortController();
    this.recapRequest = request;
    const player = this.ensureRecapPlayer();
    player.stop();
    const patch = (p: Partial<FocusRecap>) => {
      if (run === this.recapRun) this.view.set((s) => ({ recap: s.recap ? { ...s.recap, ...p } : s.recap }));
    };
    this.view.set({ recap: { speaker: i, transcript: null, text: "", thinking: true, speaking: false, error: null }, error: null });
    this.duck(true);
    try {
      await requestRecap(
        clip,
        v.rate,
        request.signal,
        {
          transcript: (t) => patch({ transcript: t }),
          text: (d) => {
            if (run === this.recapRun) this.view.set((s) => ({ recap: s.recap ? { ...s.recap, text: s.recap.text + d } : s.recap }));
          },
          audio: (pcm, sr) => {
            if (run !== this.recapRun) return;
            player.enqueue(pcm, sr);
            patch({ speaking: true });
          },
          error: (code) => patch({ error: code }),
        },
        { speechLang: this.lang },
      );
    } catch (err) {
      if (!request.signal.aborted) patch({ error: err instanceof ApiError ? err.code : "network" });
    }
    if (run !== this.recapRun) return;
    patch({ thinking: false });
    if (player.playing) {
      await new Promise<void>((r) => {
        const off = player.onEnded(() => {
          off();
          r();
        });
      });
    }
    if (run !== this.recapRun) return;
    patch({ speaking: false });
    this.duck(false);
  }

  private ensureRecapPlayer(): PcmPlayer {
    this.recapPlayer ??= new PcmPlayer(getEngine().ctx, getEngine().sources.input("focus:recap"));
    return this.recapPlayer;
  }

  private duck(on: boolean) {
    const engine = peekEngine();
    this.ducked = on;
    if (!engine) return;
    if (on) for (const id of IDS) engine.sources.setGain(id, 10 ** (DUCK_DB / 20), 0.15);
    else this.applied = undefined;
  }

  /** Stops the room, the recap and the camera. The voices stay loaded for next time. */
  stop() {
    cancelAnimationFrame(this.raf);
    this.releaseClench?.();
    this.releaseClench = null;
    this.recapRun++;
    this.recapRequest?.abort();
    this.recapPlayer?.stop();
    for (const n of this.nodes) {
      try {
        n.src.stop();
      } catch {
        // not started
      }
      n.src.disconnect();
      n.panner.disconnect();
    }
    this.nodes = [];
    const engine = peekEngine();
    if (engine) {
      setListenerYaw(engine.ctx, 0);
      engine.sources.setAttentionProvider(nullAttentionProvider);
      for (const id of IDS) engine.sources.setGain(id, 1);
    }
    headTracker.stop();
    this.ducked = false;
    this.applied = undefined;
    this.view.set({ phase: "off", attended: null, locked: null, recap: null, gainsDb: FOCUS_SPEAKERS.map(() => -Infinity) });
  }
}

export const focus = new FocusController();
