"use client";

import { MicError, outputSelectionSupported } from "./devices";
import { MicInput, type Processing } from "./mic";
import { PcmPlayer } from "./player";
import { SourceStage } from "./source-stage";

/**
 * The page's single audio graph:
 *
 *   mic(s) -> input gain -> capture worklet -> silent sink -> destination
 *   player -> SourceStage["assistant"] -> master gain -> destination (sink id)
 *
 * One AudioContext at the hardware rate serves capture and playback. It is
 * created on the first user gesture (iOS allows nothing else) and kept for
 * the life of the page, so navigating between screens never reopens it.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly sources: SourceStage;
  readonly player: PcmPlayer;
  private readonly silentSink: GainNode;
  private workletLoaded: Promise<void> | null = null;
  outputDeviceId: string | null = null;

  constructor() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new MicError("audio_unsupported");
    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.silentSink = this.ctx.createGain();
    this.silentSink.gain.value = 0;
    this.silentSink.connect(this.ctx.destination);
    this.sources = new SourceStage(this.ctx, this.master);
    this.player = new PcmPlayer(this.ctx, this.sources.input("assistant"));
  }

  /** Must run inside a user gesture the first time (autoplay rules). */
  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  private loadWorklet(): Promise<void> {
    if (!this.ctx.audioWorklet) return Promise.reject(new MicError("audio_unsupported"));
    this.workletLoaded ??= this.ctx.audioWorklet.addModule("/worklets/capture-processor.js");
    return this.workletLoaded;
  }

  async openMic(opts: { deviceId?: string; processing: Processing; gainDb?: number }): Promise<MicInput> {
    await this.loadWorklet();
    await this.resume();
    return MicInput.open(this.ctx, this.silentSink, opts);
  }

  get canSelectOutput(): boolean {
    return outputSelectionSupported();
  }

  /** Routes all playback to an output device, where the browser allows it. */
  async setOutput(deviceId: string | null): Promise<boolean> {
    if (!this.canSelectOutput) return false;
    try {
      await (this.ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId ?? "");
      this.outputDeviceId = deviceId;
      return true;
    } catch {
      return false;
    }
  }

  setVolume(gain: number) {
    this.master.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.03);
  }

  /** A short two note chime, to confirm sound reaches the earbuds. */
  playChime() {
    const t0 = this.ctx.currentTime + 0.03;
    for (const [i, freq] of [660, 880].entries()) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const start = t0 + i * 0.16;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(0.25, start + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      osc.connect(env);
      env.connect(this.sources.input("system"));
      osc.start(start);
      osc.stop(start + 0.5);
    }
  }
}

let engine: AudioEngine | null = null;
const createdHooks = new Set<(e: AudioEngine) => void>();

/** Runs once the engine exists (immediately if it already does). */
export function onEngineCreated(hook: (e: AudioEngine) => void): () => void {
  if (engine) hook(engine);
  else createdHooks.add(hook);
  return () => createdHooks.delete(hook);
}

/** The page's engine, created on first use. Call from a user gesture. */
export function getEngine(): AudioEngine {
  if (!engine) {
    engine = new AudioEngine();
    for (const h of createdHooks) h(engine);
    createdHooks.clear();
  }
  return engine;
}

export function peekEngine(): AudioEngine | null {
  return engine;
}
