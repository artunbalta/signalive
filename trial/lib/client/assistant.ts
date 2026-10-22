"use client";

import { getEngine } from "@/lib/audio/engine";
import { concat, type MicInput } from "@/lib/audio/mic";
import { loadVad, VadRunner } from "@/lib/audio/vad";
import { VAD_NORMAL, VAD_WHISPER, type VadEvent } from "@/lib/audio/vad-segmenter";
import { encodeWav, pcm16BytesToInt16, rmsDbfs } from "@/lib/shared/audio/wav";
import type { InputMode, Lang, LatencyEventInput, PublicConfig, SpeechLang, SttMode } from "@/lib/shared/types";
import { apiFetch, ApiError } from "./api";
import { base64ToBytes, readNdjson } from "./ndjson";
import { live } from "./live";
import { micManager } from "./mic-manager";
import { getPrefs, landingAt, setPrefs } from "./prefs";
import { sessionId } from "./session";
import { createStore } from "./store";
import { BrowserSttStream } from "./stt-stream";

/**
 * The assistant loop in the browser:
 *
 *   capture (push to talk, or the VAD in hands-free mode)
 *     -> live transcription when available, else the recorded utterance
 *     -> /api/assistant (LLM and TTS, streamed back)
 *     -> gapless playback
 *
 * Every stage is time stamped on the performance.now() clock and reported
 * relative to capture end, the moment we know the user has finished.
 */

export interface Turn {
  id: string;
  user: string;
  reply: string;
  status: "listening" | "pending" | "speaking" | "done" | "no_speech" | "error" | "interrupted";
  errorCode?: string;
  /** Capture end to playback start, ms. */
  latencyMs?: number;
  searchedNotes?: boolean;
}

export interface AssistantView {
  turns: Turn[];
  partial: string;
  handsFree: boolean;
  /** Hands-free listening paused by a tap. */
  paused: boolean;
  vad: "off" | "loading" | "ready" | "error";
  whisper: boolean;
  calibrating: number | null;
  error: string | null;
  /** Page open to first reply audio, measured during setup. */
  onboardingMs: number | null;
}

interface Capture {
  frames: Float32Array[];
  startedAt: number;
  mode: InputMode;
  stream: BrowserSttStream | null;
  lastVoiceAt: number | null;
}

interface Timeline {
  captureEnd: number;
  lastVoiceAt: number | null;
  sttFinal?: number;
  llmFirstToken?: number;
  firstSentence?: number;
  ttsFirstAudio?: number;
  playbackStart?: number;
}

const PREROLL_SAMPLES = 16000 * 0.4;
const MIN_SPEECH_MS = 250;
const HISTORY_TURNS = 6;
/** Stricter barge-in while the assistant is talking, so its own voice does not interrupt it. */
const BARGE_IN_THRESHOLD = 0.8;

class AssistantController {
  readonly view = createStore<AssistantView>({
    turns: [],
    partial: "",
    handsFree: false,
    paused: false,
    vad: "off",
    whisper: false,
    calibrating: null,
    error: null,
    onboardingMs: null,
  });

  private config: PublicConfig | null = null;
  private mic: MicInput | null = null;
  private offAudio: (() => void) | null = null;
  private ring: Float32Array[] = [];
  private ringSamples = 0;
  private capture: Capture | null = null;
  private inflight: AbortController | null = null;
  private vad: VadRunner | null = null;
  private onboarding = false;
  private history: { role: "user" | "assistant"; text: string }[] = [];

  configure(config: PublicConfig) {
    this.config = config;
    const p = getPrefs();
    this.view.set({ whisper: !!p.whisper, handsFree: false });
  }

  /** Opens the shared mic and starts listening for audio. Call from a gesture. */
  async activate(): Promise<void> {
    const engine = getEngine();
    await engine.resume();
    engine.setVolume(getPrefs().whisper ? 0.45 : 1);
    const mic = await micManager.ensure();
    if (mic !== this.mic) {
      this.offAudio?.();
      this.mic = mic;
      this.offAudio = mic.on16k((s, at) => this.onAudio(s, at));
      if (this.vad) this.vad.attach(mic);
    }
    if (live.get().assistant === "off") live.set({ assistant: this.view.get().handsFree ? "listening" : "idle" });
  }

  deactivate() {
    this.cancelCapture();
    this.stopSpeaking();
    this.vad?.detach();
    this.offAudio?.();
    this.offAudio = null;
    this.mic = null;
    live.set({ assistant: "off" });
  }

  setOnboarding(on: boolean) {
    this.onboarding = on;
  }

  /* ------------------------------------------------------------------------
     Audio in
     --------------------------------------------------------------------- */

  private onAudio(samples: Float32Array, at: number) {
    this.ring.push(samples);
    this.ringSamples += samples.length;
    while (this.ringSamples - (this.ring[0]?.length ?? 0) >= PREROLL_SAMPLES) {
      this.ringSamples -= this.ring.shift()!.length;
    }
    const cap = this.capture;
    if (!cap) return;
    cap.frames.push(samples);
    cap.stream?.send(samples);
    // Without the VAD, a simple level gate tells when the voice stopped.
    if (!this.vad && rmsDbfs(samples) > -48) cap.lastVoiceAt = at;
  }

  private startCapture(mode: InputMode, preroll?: Float32Array, state: "listening" | "hearing" = "hearing") {
    if (this.capture) return;
    const frames = preroll ? [preroll] : [...this.ring];
    const lang = this.speechLang();
    const canStream =
      !!this.config?.stt.streaming && lang !== "auto" && this.config.stt.streamingLanguages.includes(lang);
    const stream = canStream ? BrowserSttStream.start(lang) : null;
    if (stream) {
      stream.onPartial = (text) => this.view.set({ partial: text });
      for (const f of frames) stream.send(f);
    }
    this.capture = { frames, startedAt: performance.now(), mode, stream, lastVoiceAt: null };
    this.view.set({ partial: "", error: null });
    live.set({ assistant: state });
  }

  private cancelCapture() {
    this.capture?.stream?.close();
    this.capture = null;
    this.view.set({ partial: "" });
  }

  speechLang(): SpeechLang {
    return getPrefs().speechLang ?? "auto";
  }

  /* ------------------------------------------------------------------------
     Push to talk
     --------------------------------------------------------------------- */

  async pressStart() {
    await this.activate();
    if (this.isBusy()) this.interrupt();
    this.startCapture("ptt", undefined, "listening");
  }

  async pressEnd() {
    const cap = this.capture;
    if (!cap || cap.mode !== "ptt") return;
    const lastVoiceAt = this.vad ? this.vad.lastSpeechAt || null : cap.lastVoiceAt;
    await this.finishCapture(performance.now(), lastVoiceAt);
  }

  /** Earbud tap, keyboard or the ring in hands-free mode: start or stop listening. */
  async toggleListening() {
    if (this.view.get().handsFree) {
      const paused = !this.view.get().paused;
      this.vad?.setPaused(paused);
      if (paused) this.cancelCapture();
      this.view.set({ paused });
      live.set({ assistant: paused ? "idle" : "listening" });
      return;
    }
    if (this.capture) await this.pressEnd();
    else await this.pressStart();
  }

  isBusy(): boolean {
    return !!this.inflight || getEngine().player.playing;
  }

  /* ------------------------------------------------------------------------
     Hands-free (VAD)
     --------------------------------------------------------------------- */

  async setHandsFree(on: boolean) {
    if (!on) {
      this.vad?.detach();
      this.vad = null;
      this.cancelCapture();
      this.view.set({ handsFree: false, paused: false, vad: "off" });
      live.set({ assistant: this.mic ? "idle" : "off" });
      return;
    }
    this.view.set({ handsFree: true, paused: false, vad: "loading" });
    try {
      await this.activate();
      const model = await loadVad();
      const runner = new VadRunner(model, (e) => this.onVad(e), getPrefs().whisper ? VAD_WHISPER : VAD_NORMAL);
      runner.attach(this.mic!);
      this.vad = runner;
      this.view.set({ vad: "ready" });
      live.set({ assistant: "listening" });
    } catch {
      this.view.set({ handsFree: false, vad: "error", error: "vad_failed" });
    }
  }

  private onVad(e: VadEvent) {
    if (!this.view.get().handsFree || this.view.get().paused) return;
    const speaking = getEngine().player.playing || !!this.inflight;
    if (e.type === "start") {
      if (!speaking) this.startCapture("vad", e.preroll);
    } else if (e.type === "confirmed") {
      if (speaking && getPrefs().bargeIn !== false && this.vad && this.vad.last.prob >= BARGE_IN_THRESHOLD) {
        this.interrupt();
        this.startCapture("vad");
      }
    } else if (e.type === "end") {
      if (this.capture?.mode === "vad") {
        // The segment's own audio has no gap at its start, unlike frames
        // gathered after the start event was reported.
        void this.finishCapture(e.at, e.lastSpeechAt, e.audio);
      } else if (!speaking && e.speechMs >= 300 && !this.capture) {
        // Speech that began while the reply was still finishing.
        this.capture = { frames: [], startedAt: e.at, mode: "vad", stream: null, lastVoiceAt: e.lastSpeechAt };
        void this.finishCapture(e.at, e.lastSpeechAt, e.audio);
      }
    } else if (e.type === "misfire") {
      if (this.capture?.mode === "vad") this.cancelCapture();
      live.set({ assistant: speaking ? "speaking" : "listening" });
    }
  }

  /* ------------------------------------------------------------------------
     Whisper mode
     --------------------------------------------------------------------- */

  async setWhisper(on: boolean) {
    setPrefs({ whisper: on });
    this.view.set({ whisper: on });
    getEngine().setVolume(on ? 0.45 : 1);
    this.vad?.segmenter.setOptions(on ? VAD_WHISPER : VAD_NORMAL);
    // Switches the mic to the profile with automatic gain control (or back).
    if (this.mic) {
      const before = this.mic;
      const mic = await micManager.ensure();
      if (mic !== before) {
        this.offAudio?.();
        this.mic = mic;
        this.offAudio = mic.on16k((s, at) => this.onAudio(s, at));
        this.vad?.attach(mic);
      }
    }
  }

  /**
   * Three seconds of whispering; the input gain is set so the whisper lands
   * near -26 dBFS, at most +24 dB.
   */
  async calibrateWhisper(): Promise<number | null> {
    await this.activate();
    const mic = this.mic!;
    mic.setGainDb(0);
    const chunks: Float32Array[] = [];
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const off = mic.on16k((s) => {
        chunks.push(s);
        const left = 3000 - (performance.now() - started);
        this.view.set({ calibrating: Math.max(0, Math.ceil(left / 1000)) });
        if (left <= 0) {
          off();
          resolve();
        }
      });
    });
    this.view.set({ calibrating: null });
    const audio = concat(chunks);
    // Level of the louder half of 20 ms frames: the whisper, not the pauses.
    const frame = 320;
    const levels: number[] = [];
    for (let i = 0; i + frame <= audio.length; i += frame) levels.push(rmsDbfs(audio.subarray(i, i + frame)));
    levels.sort((a, b) => b - a);
    const loud = levels.slice(0, Math.max(1, Math.floor(levels.length / 2)));
    const level = loud.reduce((a, b) => a + b, 0) / loud.length;
    if (!Number.isFinite(level)) return null;
    const gainDb = Math.round(Math.max(0, Math.min(24, -26 - level)) * 10) / 10;
    setPrefs({ whisperGainDb: gainDb });
    mic.setGainDb(getPrefs().whisper ? gainDb : 0);
    return gainDb;
  }

  /* ------------------------------------------------------------------------
     A turn
     --------------------------------------------------------------------- */

  /** Stops the reply now (barge-in, or the stop button). */
  interrupt() {
    this.inflight?.abort();
    this.inflight = null;
    getEngine().player.stop();
    const turns = this.view.get().turns;
    const last = turns[0];
    if (last && (last.status === "pending" || last.status === "speaking")) {
      this.updateTurn(last.id, { status: "interrupted" });
    }
  }

  stopSpeaking() {
    this.interrupt();
    live.set({ assistant: this.restingState() });
  }

  private restingState() {
    const v = this.view.get();
    if (v.handsFree && !v.paused) return "listening" as const;
    return this.mic ? ("idle" as const) : ("off" as const);
  }

  clear() {
    this.history = [];
    this.view.set({ turns: [] });
  }

  private updateTurn(id: string, patch: Partial<Turn>) {
    this.view.set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }

  private async finishCapture(captureEnd: number, lastVoiceAt: number | null, audioOverride?: Float32Array) {
    const cap = this.capture;
    if (!cap) return;
    this.capture = null;
    const audio = audioOverride ?? concat(cap.frames);
    const speechMs = (audio.length / 16000) * 1000;
    const turnId = crypto.randomUUID();
    const turn: Turn = { id: turnId, user: this.view.get().partial, reply: "", status: "pending" };
    this.view.set((s) => ({ turns: [turn, ...s.turns].slice(0, 30), partial: "" }));

    const tl: Timeline = { captureEnd, lastVoiceAt };
    const silent = speechMs < MIN_SPEECH_MS || rmsDbfs(audio) < -60;
    if (silent && !cap.stream) {
      this.updateTurn(turnId, { status: "no_speech" });
      live.set({ assistant: this.view.get().handsFree ? "listening" : "idle" });
      return;
    }

    live.set({ assistant: "transcribing" });
    let transcript: string | null = null;
    let sttMode: SttMode = "batch";
    if (cap.stream) {
      transcript = await cap.stream.finish();
      if (transcript !== null) {
        tl.sttFinal = performance.now();
        sttMode = "stream";
        this.updateTurn(turnId, { user: transcript });
        if (!transcript.trim()) {
          this.updateTurn(turnId, { status: "no_speech" });
          live.set({ assistant: this.view.get().handsFree ? "listening" : "idle" });
          return;
        }
      }
    }

    const lang = this.speechLang();
    const meta = {
      turnId,
      sessionId: sessionId(),
      speechLang: lang,
      whisper: !!getPrefs().whisper,
      history: this.history.slice(-HISTORY_TURNS * 2),
      now: new Date().toLocaleString(lang === "tr" ? "tr-TR" : "en-GB", { dateStyle: "full", timeStyle: "short" }),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      speechMs,
      ...(transcript !== null ? { transcript, sttProvider: this.config?.stt.provider, sttModel: this.config?.stt.model } : {}),
    };

    let body: BodyInit;
    if (transcript !== null) {
      body = JSON.stringify(meta);
    } else {
      const form = new FormData();
      form.append("meta", JSON.stringify(meta));
      form.append("audio", new Blob([encodeWav(audio, 16000) as BlobPart], { type: "audio/wav" }), "utterance.wav");
      body = form;
    }

    const controller = new AbortController();
    this.inflight = controller;
    const engine = getEngine();
    engine.player.reset();
    let replyLang: Lang | null = null;
    let errorCode: string | null = null;
    let userText = transcript ?? "";
    let replyText = "";

    try {
      const res = await apiFetch("/api/assistant", {
        method: "POST",
        body,
        headers: transcript !== null ? { "Content-Type": "application/json" } : undefined,
        signal: controller.signal,
      });
      live.set({ assistant: "thinking" });
      await readNdjson(res, (ev) => {
        if (controller.signal.aborted) return;
        switch (ev.t) {
          case "transcript":
            tl.sttFinal = performance.now();
            userText = String(ev.text ?? "");
            this.updateTurn(turnId, { user: userText });
            break;
          case "no_speech":
            this.updateTurn(turnId, { status: "no_speech" });
            break;
          case "tool":
            if (ev.state === "start") {
              live.set({ assistant: "searching" });
              this.updateTurn(turnId, { searchedNotes: true });
            } else live.set({ assistant: "thinking" });
            break;
          case "text":
            tl.llmFirstToken ??= performance.now();
            replyText += String(ev.delta ?? "");
            this.updateTurn(turnId, { reply: replyText });
            break;
          case "sentence":
            tl.firstSentence ??= performance.now();
            break;
          case "audio": {
            const bytes = base64ToBytes(String(ev.pcm ?? ""));
            const at = engine.player.enqueue(pcm16BytesToInt16(bytes), Number(ev.sr) || 24000);
            if (tl.ttsFirstAudio === undefined) {
              tl.ttsFirstAudio = performance.now();
              tl.playbackStart = at;
              this.updateTurn(turnId, { status: "speaking", latencyMs: at - tl.captureEnd });
              live.set({ assistant: "speaking", lastLatencyMs: at - tl.captureEnd });
            }
            break;
          }
          case "done":
            replyLang = (ev.language as Lang) ?? null;
            break;
          case "error":
            errorCode = String(ev.code ?? "generic");
            break;
        }
      });
    } catch (err) {
      if (controller.signal.aborted) {
        errorCode = null;
      } else {
        errorCode = err instanceof ApiError ? err.code : "network";
      }
    }

    const interrupted = controller.signal.aborted;
    if (this.inflight === controller) this.inflight = null;
    // Every stage is known once the response stream has ended, while the
    // reply may play for many seconds more: report now, so leaving the page
    // mid-reply does not lose the measurement.
    if (tl.playbackStart !== undefined || errorCode) {
      void this.report(turnId, cap.mode, sttMode, tl, replyLang, errorCode, interrupted);
    }

    const current = this.view.get().turns.find((t) => t.id === turnId);
    if (errorCode) {
      this.updateTurn(turnId, { status: "error", errorCode });
      this.view.set({ error: errorCode });
    } else if (!interrupted && current?.status !== "no_speech") {
      if (userText && replyText) {
        this.history.push({ role: "user", text: userText }, { role: "assistant", text: replyText });
        this.history = this.history.slice(-HISTORY_TURNS * 2);
      }
      await new Promise<void>((resolve) => {
        if (!engine.player.playing) return resolve();
        const off = engine.player.onEnded(() => {
          off();
          resolve();
        });
      });
      this.updateTurn(turnId, { status: "done" });
    }

    if (!interrupted) {
      live.set({ assistant: this.restingState() });
    }
  }

  private async report(
    turnId: string,
    mode: InputMode,
    sttMode: SttMode,
    tl: Timeline,
    language: Lang | null,
    errorCode: string | null,
    bargeIn: boolean,
  ) {
    const rel = (t?: number) => (t === undefined ? null : Math.max(0, t - tl.captureEnd));
    const base: LatencyEventInput = {
      sessionId: sessionId(),
      turnId,
      kind: "turn",
      inputMode: mode,
      whisper: !!getPrefs().whisper,
      language,
      sttProvider: this.config?.stt.provider ?? null,
      sttMode,
      llmModel: this.config?.llm.model ?? null,
      ttsProvider: this.config?.tts.provider ?? null,
      endpointingMs: tl.lastVoiceAt ? Math.max(0, tl.captureEnd - tl.lastVoiceAt) : null,
      sttFinalMs: rel(tl.sttFinal),
      llmFirstTokenMs: rel(tl.llmFirstToken),
      firstSentenceMs: rel(tl.firstSentence),
      ttsFirstAudioMs: rel(tl.ttsFirstAudio),
      playbackStartMs: rel(tl.playbackStart),
      sinceLandingMs: null,
      bargeIn,
      errorCode,
    };
    const send = (e: LatencyEventInput) =>
      apiFetch("/api/latency", { method: "POST", json: e, keepalive: true }).catch(() => undefined);
    await send(base);
    if (this.onboarding && tl.playbackStart !== undefined) {
      const landed = landingAt();
      if (landed) {
        const since = Date.now() - (performance.now() - tl.playbackStart) - landed;
        await send({ ...base, turnId: crypto.randomUUID(), kind: "onboarding", sinceLandingMs: Math.max(0, since) });
        this.view.set({ onboardingMs: since });
      }
    }
  }
}

export const assistant = new AssistantController();
