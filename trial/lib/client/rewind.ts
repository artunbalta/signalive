"use client";

import { toMicError } from "@/lib/audio/devices";
import { getEngine } from "@/lib/audio/engine";
import type { MicInput } from "@/lib/audio/mic";
import { PcmPlayer } from "@/lib/audio/player";
import { RingBuffer } from "@/lib/audio/ring-buffer";
import { REWIND_BUFFER_SEC, REWIND_LENGTHS } from "@/lib/shared/constants";
import { ApiError } from "./api";
import { assistant } from "./assistant";
import { live } from "./live";
import { micManager, type MicChange } from "./mic-manager";
import { MIN_RECAP_SEC, requestRecap } from "./recap";
import { createStore } from "./store";

/**
 * Rewind: the last 30 seconds the microphone heard, kept in this tab's
 * memory only and overwritten as it goes. A jaw clench (the J key, a bound
 * earbud gesture, or the button standing in for both) replays the chosen
 * seconds in the earbuds, then the assistant tells what was said. The same
 * seconds go to the server once, for recognition and the recap, and are not
 * stored there.
 */

export type RewindPhase = "off" | "starting" | "listening" | "clench" | "rewinding" | "replaying" | "narrating";

export interface RewindView {
  phase: RewindPhase;
  /** performance.now() when the phase began; the figure animates from it. */
  phaseAt: number;
  /** Seconds held in the buffer. */
  buffered: number;
  /** How far the next rewind goes. */
  seconds: number;
  /** Length of the clip being replayed or recapped. */
  clipSeconds: number;
  transcript: string | null;
  recap: string;
  /** The recap is still arriving. */
  thinking: boolean;
  error: string | null;
}

/** How long the clench and the rewind effect take before the replay starts. */
export const CLENCH_MS = 520;
export const REWIND_MS = 1100;

const REWIND_RATE = 2.6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RewindController {
  readonly view = createStore<RewindView>({
    phase: "off",
    phaseAt: 0,
    buffered: 0,
    seconds: REWIND_LENGTHS[0],
    clipSeconds: 0,
    transcript: null,
    recap: "",
    thinking: false,
    error: null,
  });

  private buffer: RingBuffer | null = null;
  private sampleRate = 48000;
  private mic: MicInput | null = null;
  private detachSamples: (() => void) | null = null;
  private offMicChange: (() => void) | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;

  private run = 0;
  private request: AbortController | null = null;
  private clipSource: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private player: PcmPlayer | null = null;
  private pending: { pcm: Int16Array; sr: number }[] = [];
  private streamFinished: Promise<void> = Promise.resolve();
  private levelData: Float32Array<ArrayBuffer> | null = null;

  private setPhase(phase: RewindPhase, extra: Partial<RewindView> = {}) {
    this.view.set({ phase, phaseAt: performance.now(), ...extra });
  }

  setSeconds(seconds: number) {
    this.view.set({ seconds });
  }

  /** Starts keeping the last 30 seconds. Call from a user gesture on iOS. */
  async enable() {
    if (this.view.get().phase !== "off") return;
    this.setPhase("starting", { error: null });
    try {
      await getEngine().resume();
      const mic = await micManager.ensure();
      this.attach(mic);
      this.offMicChange = micManager.onChange((m, change) => this.onMicChange(m, change));
      this.tick = setInterval(() => {
        this.view.set({ buffered: this.buffer ? this.buffer.length / this.sampleRate : 0 });
      }, 250);
      live.set({ rewindOn: true });
      this.setPhase("listening");
    } catch (err) {
      this.setPhase("off", { error: toMicError(err).code });
    }
  }

  /** Stops listening and overwrites what was held. */
  disable() {
    this.stop();
    this.detachSamples?.();
    this.detachSamples = null;
    this.offMicChange?.();
    this.offMicChange = null;
    this.mic = null;
    this.buffer?.clear();
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    live.set({ rewindOn: false });
    this.setPhase("off", { buffered: 0 });
  }

  private attach(mic: MicInput) {
    this.detachSamples?.();
    const rate = mic.ctx.sampleRate;
    if (!this.buffer || rate !== this.sampleRate) {
      this.sampleRate = rate;
      this.buffer = new RingBuffer(REWIND_BUFFER_SEC * rate);
    }
    this.mic = mic;
    this.detachSamples = mic.onSamples((s) => this.buffer?.push(s));
  }

  // The shared mic reopens when the device or profile changes (follow it),
  // and closes when another part of the app needs it raw (stop with it).
  private onMicChange(mic: MicInput | null, change: MicChange) {
    if (change === "opened" && mic) this.attach(mic);
    else if (change === "lost") {
      this.disable();
      this.view.set({ error: "mic_not_found" });
    } else if (change === "closed") this.disable();
  }

  /** The jaw clench: replay the chosen seconds, then tell what was said. */
  async trigger() {
    const v = this.view.get();
    if (v.phase === "off" || v.phase === "starting") {
      this.view.set({ error: "rewind_off" });
      return;
    }
    if (v.phase !== "listening" || !this.buffer) return;
    if (this.buffer.length < this.sampleRate * MIN_RECAP_SEC) {
      this.view.set({ error: "rewind_empty" });
      return;
    }
    assistant.stopSpeaking();
    const rate = this.sampleRate;
    const clip = this.buffer.latest(v.seconds * rate);
    const clipSeconds = clip.length / rate;
    const run = ++this.run;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.pending = [];
    this.player?.stop();

    this.setPhase("clench", { clipSeconds, transcript: null, recap: "", thinking: true, error: null });
    // The server works while the clench, the rewind and the replay play.
    this.streamFinished = this.fetchRecap(clip, rate, request, run);
    const gain = loudnessGain(clip);

    await sleep(CLENCH_MS);
    if (run !== this.run) return;
    this.setPhase("rewinding");
    this.playRewindSound(clip, rate, gain);
    await sleep(REWIND_MS);
    if (run !== this.run) return;
    this.setPhase("replaying");
    await this.playClip(clip, rate, gain);
    if (run !== this.run) return;
    this.setPhase("narrating");
    const player = this.ensureOutput().player;
    for (const { pcm, sr } of this.pending.splice(0)) player.enqueue(pcm, sr);
    await this.streamFinished;
    if (run !== this.run) return;
    if (player.playing) await new Promise<void>((r) => {
      const off = player.onEnded(() => {
        off();
        r();
      });
    });
    if (run !== this.run) return;
    this.setPhase("listening");
  }

  /** Stops a replay or recap in progress; listening goes on. */
  stop() {
    this.run++;
    this.request?.abort();
    this.request = null;
    try {
      this.clipSource?.stop();
    } catch {
      // not started yet
    }
    this.clipSource = null;
    this.player?.stop();
    this.pending = [];
    const { phase } = this.view.get();
    if (phase !== "off" && phase !== "starting" && phase !== "listening") this.setPhase("listening", { thinking: false });
  }

  /** 0..1: what is playing during a rewind, otherwise what the microphone hears. */
  level(): number {
    const { phase } = this.view.get();
    let db = -Infinity;
    if ((phase === "rewinding" || phase === "replaying" || phase === "narrating") && this.analyser) {
      this.levelData ??= new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(this.levelData);
      let sum = 0;
      for (const s of this.levelData) sum += s * s;
      db = 10 * Math.log10(sum / this.levelData.length + 1e-12);
    } else if (this.mic) {
      db = this.mic.level.rmsDb;
    }
    return Number.isFinite(db) ? Math.min(1, Math.max(0, (db + 60) / 45)) : 0;
  }

  private ensureOutput(): { input: AudioNode; player: PcmPlayer } {
    if (!this.analyser || !this.gain || !this.player) {
      const engine = getEngine();
      this.analyser = engine.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(engine.sources.input("rewind"));
      this.gain = engine.ctx.createGain();
      this.gain.connect(this.analyser);
      this.player = new PcmPlayer(engine.ctx, this.analyser);
    }
    return { input: this.gain, player: this.player };
  }

  /** The real seconds, reversed and sped up like tape spooling back, over a falling whirr. */
  private playRewindSound(clip: Float32Array, rate: number, gain: number) {
    const ctx = getEngine().ctx;
    const out = this.ensureOutput().input;
    const n = Math.min(clip.length, Math.round(rate * (REWIND_MS / 1000) * REWIND_RATE));
    const reversed = new Float32Array(n);
    for (let i = 0; i < n; i++) reversed[i] = clip[clip.length - 1 - i]!;
    const buf = ctx.createBuffer(1, n, rate);
    buf.copyToChannel(reversed, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = REWIND_RATE;
    const t0 = ctx.currentTime + 0.02;
    const dur = n / rate / REWIND_RATE;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.45 * gain, t0 + 0.08);
    env.gain.setValueAtTime(0.45 * gain, Math.max(t0 + 0.09, t0 + dur - 0.25));
    env.gain.linearRampToValueAtTime(0, t0 + dur);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3500;
    src.connect(lowpass).connect(env).connect(out);
    src.start(t0);

    const whirr = ctx.createOscillator();
    whirr.type = "sawtooth";
    whirr.frequency.setValueAtTime(520, t0);
    whirr.frequency.exponentialRampToValueAtTime(140, t0 + REWIND_MS / 1000);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 0.8;
    const wenv = ctx.createGain();
    wenv.gain.setValueAtTime(0, t0);
    wenv.gain.linearRampToValueAtTime(0.035, t0 + 0.1);
    wenv.gain.linearRampToValueAtTime(0, t0 + REWIND_MS / 1000);
    whirr.connect(band).connect(wenv).connect(out);
    whirr.start(t0);
    whirr.stop(t0 + REWIND_MS / 1000 + 0.05);
  }

  private playClip(clip: Float32Array<ArrayBuffer>, rate: number, gain: number): Promise<void> {
    const ctx = getEngine().ctx;
    const out = this.ensureOutput().input;
    const buf = ctx.createBuffer(1, Math.max(1, clip.length), rate);
    buf.copyToChannel(clip, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    this.clipSource = src;
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.clipSource === src) this.clipSource = null;
        g.disconnect();
        resolve();
      };
      src.start(ctx.currentTime + 0.03);
    });
  }

  private async fetchRecap(clip: Float32Array, rate: number, request: AbortController, run: number) {
    const current = () => run === this.run;
    try {
      await requestRecap(clip, rate, request.signal, {
        transcript: (text) => current() && this.view.set({ transcript: text }),
        text: (delta) => current() && this.view.set((s) => ({ recap: s.recap + delta })),
        audio: (pcm, sr) => {
          if (!current()) return;
          // The recap waits for the replay to end, then plays as it arrives.
          if (this.view.get().phase === "narrating") this.ensureOutput().player.enqueue(pcm, sr);
          else this.pending.push({ pcm, sr });
        },
        error: (code) => current() && this.view.set({ error: code }),
      });
    } catch (err) {
      if (!request.signal.aborted && current()) this.view.set({ error: err instanceof ApiError ? err.code : "network" });
    } finally {
      if (current()) this.view.set({ thinking: false });
    }
  }
}

/**
 * Brings quiet surroundings up to a listenable level: RMS toward -24 dBFS,
 * at most +15 dB, never past the clip's peak.
 */
export function loudnessGain(clip: Float32Array): number {
  let sum = 0;
  let peak = 0;
  for (const s of clip) {
    sum += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  if (!clip.length || peak === 0) return 1;
  const rms = Math.sqrt(sum / clip.length);
  const want = 10 ** (-24 / 20) / rms;
  return Math.max(1, Math.min(want, 10 ** (15 / 20), 0.95 / peak));
}

export const rewind = new RewindController();
