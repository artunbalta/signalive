"use client";

import { analyzeMicCheck, estimateSnrDb, LowFrequencyMeter } from "@/lib/audio/analysis";
import { runChains } from "@/lib/audio/chains";
import { getEngine } from "@/lib/audio/engine";
import { concat, type MicInput } from "@/lib/audio/mic";
import { loadVad, VadRunner } from "@/lib/audio/vad";
import { VAD_NORMAL, VAD_WHISPER } from "@/lib/audio/vad-segmenter";
import { encodeWav, rmsDbfs } from "@/lib/shared/audio/wav";
import { MAX_LAB_TAKE_MS } from "@/lib/shared/constants";
import { phrasesFor, quickSet, type Phrase } from "@/lib/shared/lab/phrases";
import type { ChainId, Environment, LabResult, LabRun, Lang, PublicConfig, SttProviderId, VoiceStyle } from "@/lib/shared/types";
import { api, apiFetch, ApiError } from "./api";
import { assistant } from "./assistant";
import { micManager } from "./mic-manager";
import { getPrefs } from "./prefs";
import { recorder } from "./recorder";
import { cachedProfile, deviceProfileId, sessionId } from "./session";
import { createStore } from "./store";

/**
 * The guided lab run. Two captures of the same microphone run side by side:
 * one raw, one with the browser's default processing (where the browser can
 * hold both at once; Safari cannot). Each take is recorded once and turned
 * into one 16 kHz file per chain, which the server sends to every recognizer.
 * Scoring happens in the background so the reader can move on.
 */

export interface LabSetup {
  language: Lang;
  voiceStyle: VoiceStyle;
  environment: Environment;
  chains: ChainId[];
  providers: SttProviderId[];
  count: 10 | 30;
  storeAudio: boolean;
}

export interface TakeView {
  takeId: string;
  phraseId: string;
  status: "processing" | "scored" | "error" | "silent" | "too_long";
  rows: LabResult[];
  error?: string;
}

export interface LabView {
  stage: "setup" | "starting" | "ready" | "recording" | "done";
  run: LabRun | null;
  phrases: Phrase[];
  index: number;
  takes: Record<string, TakeView>;
  dual: boolean | null;
  vad: "off" | "loading" | "ready" | "error";
  elapsedMs: number;
  pending: number;
  error: string | null;
}

class LabController {
  readonly view = createStore<LabView>({
    stage: "setup",
    run: null,
    phrases: [],
    index: 0,
    takes: {},
    dual: null,
    vad: "off",
    elapsedMs: 0,
    pending: 0,
    error: null,
  });

  private config: PublicConfig | null = null;
  private raw: MicInput | null = null;
  private processed: MicInput | null = null;
  private vad: VadRunner | null = null;
  private rawChunks: Float32Array[] = [];
  private processedChunks: Float32Array[] = [];
  private offTake: (() => void)[] = [];
  private takeStarted = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;

  configure(c: PublicConfig) {
    this.config = c;
  }

  async startRun(setup: LabSetup) {
    this.view.set({ stage: "starting", error: null, takes: {}, index: 0 });
    try {
      if (recorder.view.get().state !== "off") await recorder.stop();
      if (assistant.view.get().handsFree) await assistant.setHandsFree(false);
      micManager.close();
      const engine = getEngine();
      await engine.resume();
      const deviceId = getPrefs().inputDeviceId;
      this.raw = await engine.openMic({ deviceId, processing: "raw" });

      let dual = false;
      if (setup.chains.includes("browser_default")) {
        try {
          this.processed = await engine.openMic({ deviceId, processing: "browser" });
          await new Promise((r) => setTimeout(r, 300));
          // Some browsers end the first capture when a second one opens, or
          // ignore the differing processing settings.
          dual =
            this.raw.live &&
            this.processed.live &&
            this.raw.settings.echoCancellation !== this.processed.settings.echoCancellation;
        } catch {
          dual = false;
        }
        if (!dual) {
          this.processed?.close();
          this.processed = null;
          if (!this.raw.live) this.raw = await engine.openMic({ deviceId, processing: "raw" });
        }
      }

      if (setup.storeAudio) {
        await api("/api/consent", {
          method: "POST",
          json: { kind: "lab_audio", version: this.config?.consentVersion ?? "", granted: true },
        });
      }
      const profile = cachedProfile();
      const run = await api<LabRun>("/api/lab/runs", {
        method: "POST",
        json: {
          sessionId: sessionId(),
          deviceProfileId: deviceProfileId(),
          deviceLabel: profile?.inputLabel || this.raw.label || "unknown",
          language: setup.language,
          voiceStyle: setup.voiceStyle,
          environment: setup.environment,
          chains: setup.chains,
          providers: setup.providers,
          storeAudio: setup.storeAudio,
          dualCapture: dual,
        },
      });
      const phrases = setup.count === 10 ? quickSet(setup.language) : phrasesFor(setup.language);
      this.view.set({ stage: "ready", run, phrases, dual, index: 0 });
      void this.startVad(setup.voiceStyle);
    } catch (err) {
      this.closeMics();
      this.view.set({ stage: "setup", error: err instanceof ApiError ? err.code : (err as { code?: string }).code ?? "generic" });
    }
  }

  /** Voice detection ends a take after a pause; Stop always works too. */
  private async startVad(voice: VoiceStyle) {
    this.view.set({ vad: "loading" });
    try {
      const model = await loadVad();
      if (!this.raw) return;
      const runner = new VadRunner(
        model,
        (e) => {
          if (e.type === "end" && this.view.get().stage === "recording") void this.stopTake();
        },
        { ...(voice === "whisper" ? VAD_WHISPER : VAD_NORMAL), redemptionMs: 900, maxSpeechMs: MAX_LAB_TAKE_MS },
      );
      runner.attach(this.raw);
      runner.setPaused(true);
      this.vad = runner;
      this.view.set({ vad: "ready" });
    } catch {
      this.view.set({ vad: "error" });
    }
  }

  get phrase(): Phrase | undefined {
    const v = this.view.get();
    return v.phrases[v.index];
  }

  startTake() {
    const v = this.view.get();
    if (v.stage !== "ready" || !this.raw) return;
    this.rawChunks = [];
    this.processedChunks = [];
    this.offTake = [this.raw.onSamples((s) => this.rawChunks.push(s))];
    if (this.processed) this.offTake.push(this.processed.onSamples((s) => this.processedChunks.push(s)));
    this.vad?.setPaused(false);
    this.takeStarted = performance.now();
    this.ticker = setInterval(() => {
      const elapsed = performance.now() - this.takeStarted;
      this.view.set({ elapsedMs: elapsed });
      if (elapsed > MAX_LAB_TAKE_MS) void this.stopTake();
    }, 200);
    this.view.set({ stage: "recording", elapsedMs: 0 });
  }

  async stopTake() {
    if (this.view.get().stage !== "recording") return;
    for (const off of this.offTake) off();
    this.offTake = [];
    this.vad?.setPaused(true);
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.view.set({ stage: "ready" });

    const phrase = this.phrase;
    const run = this.view.get().run;
    if (!phrase || !run || !this.raw) return;
    const rate = this.raw.ctx.sampleRate;
    const raw = concat(this.rawChunks);
    const processed = this.processed ? concat(this.processedChunks) : null;
    const durationMs = (raw.length / rate) * 1000;

    // A redo replaces the earlier take of the same phrase.
    const previous = this.view.get().takes[phrase.id];
    if (previous) void apiFetch(`/api/lab/results?takeId=${previous.takeId}`, { method: "DELETE" }).catch(() => undefined);

    const takeId = crypto.randomUUID();
    const setTake = (t: Partial<TakeView>) =>
      this.view.set((s) => {
        const current = s.takes[phrase.id];
        const base: TakeView =
          current?.takeId === takeId ? current : { takeId, phraseId: phrase.id, status: "processing", rows: [] };
        return { takes: { ...s.takes, [phrase.id]: { ...base, ...t } } };
      });

    if (durationMs > MAX_LAB_TAKE_MS + 500) return setTake({ status: "too_long" });
    if (rmsDbfs(raw) < -60 || analyzeMicCheck(raw, rate).speechFrames < 5) return setTake({ status: "silent" });

    setTake({ status: "processing" });
    this.view.set((s) => ({ pending: s.pending + 1 }));
    try {
      const lf = new LowFrequencyMeter(rate);
      lf.push(raw);
      const check = analyzeMicCheck(raw, rate);
      const metrics = {
        rmsDbfs: Number.isFinite(check.speechDbfs) ? check.speechDbfs : null,
        snrDbEstimate: estimateSnrDb(raw, rate),
        lowFreqRatio: lf.average,
      };
      const { outputs, errors } = await runChains({ raw, rate, processed }, run.chains);

      let audioObjectId: string | null = null;
      if (run.storeAudio) {
        const form = new FormData();
        form.append("meta", JSON.stringify({ runId: run.id }));
        form.append("audio", new Blob([encodeWav(raw, rate) as BlobPart], { type: "audio/wav" }), "take.wav");
        audioObjectId = (await (await apiFetch("/api/lab/audio", { method: "POST", body: form })).json()).audioObjectId;
      }

      const form = new FormData();
      form.append("meta", JSON.stringify({ runId: run.id, takeId, phraseId: phrase.id, audioObjectId, metrics, chainErrors: errors }));
      for (const [chain, audio] of Object.entries(outputs)) {
        form.append(`chain_${chain}`, new Blob([encodeWav(audio!, 16000) as BlobPart], { type: "audio/wav" }), `${chain}.wav`);
      }
      const rows = await (await apiFetch("/api/lab/transcribe", { method: "POST", body: form })).json();
      setTake({ status: "scored", rows });
    } catch (err) {
      setTake({ status: "error", error: err instanceof ApiError ? err.code : "generic" });
    } finally {
      this.view.set((s) => ({ pending: s.pending - 1 }));
    }
  }

  next() {
    const v = this.view.get();
    if (v.stage !== "ready") return;
    if (v.index + 1 >= v.phrases.length) void this.finish();
    else this.view.set({ index: v.index + 1 });
  }

  previous() {
    const v = this.view.get();
    if (v.stage === "ready" && v.index > 0) this.view.set({ index: v.index - 1 });
  }

  async finish() {
    const run = this.view.get().run;
    this.closeMics();
    this.view.set({ stage: "done" });
    if (run) await api("/api/lab/runs", { method: "PATCH", json: { id: run.id } }).catch(() => undefined);
  }

  reset() {
    this.closeMics();
    this.view.set({ stage: "setup", run: null, phrases: [], index: 0, takes: {}, error: null, elapsedMs: 0 });
  }

  private closeMics() {
    for (const off of this.offTake) off();
    this.offTake = [];
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.vad?.detach();
    this.vad = null;
    this.raw?.close();
    this.processed?.close();
    this.raw = null;
    this.processed = null;
    this.view.set({ vad: "off" });
  }
}

export const lab = new LabController();
