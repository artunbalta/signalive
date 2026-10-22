"use client";

import { StreamingResampler } from "./resample";
import { toMicError } from "./devices";

/**
 * One open microphone: a MediaStream, its source node, an input gain (set by
 * whisper calibration), and the capture worklet. Listeners receive mono
 * chunks at the context rate, or at 16 kHz through on16k().
 *
 * Processing profiles:
 *  voice    echo cancellation and noise suppression on, gain control off,
 *           so levels mean something (the assistant's normal chain)
 *  browser  all three on, which is what getUserMedia({ audio: true }) gives:
 *           the lab's "browser default" chain, and whisper mode (gain control)
 *  raw      everything off (the lab's raw take and the wind test)
 */
export type Processing = "voice" | "browser" | "raw";

export const STT_RATE = 16000;

type ChunkListener = (samples: Float32Array, at: number) => void;

/**
 * Every open microphone in the page, whatever opened it, so the status strip
 * can never claim the mic is off while anything is capturing.
 */
let openCount = 0;
const countListeners = new Set<(n: number) => void>();
export function onOpenMicCount(l: (n: number) => void): () => void {
  countListeners.add(l);
  l(openCount);
  return () => countListeners.delete(l);
}
function setOpenCount(n: number) {
  openCount = n;
  for (const l of countListeners) l(n);
}

export class MicInput {
  private readonly listeners = new Set<ChunkListener>();
  private readonly listeners16k = new Set<ChunkListener>();
  private resampler: StreamingResampler | null = null;
  private closed = false;
  /** Smoothed RMS and decaying peak of the latest chunks, in dBFS. */
  level = { rmsDb: -Infinity, peakDb: -Infinity };

  private constructor(
    readonly ctx: AudioContext,
    readonly stream: MediaStream,
    readonly source: MediaStreamAudioSourceNode,
    readonly gain: GainNode,
    readonly node: AudioWorkletNode,
    readonly processing: Processing,
  ) {
    node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onChunk(e.data);
    setOpenCount(openCount + 1);
  }

  static async open(
    ctx: AudioContext,
    sink: AudioNode,
    opts: { deviceId?: string; processing: Processing; gainDb?: number },
  ): Promise<MicInput> {
    if (!navigator.mediaDevices?.getUserMedia) throw toMicError(new TypeError("no mediaDevices"));
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
          echoCancellation: opts.processing !== "raw",
          noiseSuppression: opts.processing !== "raw",
          autoGainControl: opts.processing === "browser",
          channelCount: { ideal: 1 },
        },
        video: false,
      });
    } catch (err) {
      throw toMicError(err);
    }
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 10 ** ((opts.gainDb ?? 0) / 20);
    const node = new AudioWorkletNode(ctx, "signalive-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { chunkSize: 1024 },
    });
    source.connect(gain);
    gain.connect(node);
    // The worklet writes silence; connecting it keeps it processing in every
    // browser without making the microphone audible.
    node.connect(sink);
    return new MicInput(ctx, stream, source, gain, node, opts.processing);
  }

  get track(): MediaStreamTrack {
    return this.stream.getAudioTracks()[0]!;
  }

  get label(): string {
    return this.track?.label ?? "";
  }

  get deviceId(): string | undefined {
    return this.track?.getSettings().deviceId;
  }

  /** What the browser reports for the capture track (rate may be missing). */
  get settings(): MediaTrackSettings {
    return this.track?.getSettings() ?? {};
  }

  get live(): boolean {
    return !this.closed && this.track?.readyState === "live";
  }

  setGainDb(db: number) {
    this.gain.gain.setTargetAtTime(10 ** (db / 20), this.ctx.currentTime, 0.02);
  }

  onSamples(l: ChunkListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** 16 kHz mono chunks for voice detection and recognizers. */
  on16k(l: ChunkListener): () => void {
    if (!this.resampler) this.resampler = new StreamingResampler(this.ctx.sampleRate, STT_RATE);
    this.listeners16k.add(l);
    return () => this.listeners16k.delete(l);
  }

  private onChunk(samples: Float32Array) {
    if (this.closed) return;
    const at = performance.now();
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      sum += s * s;
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
    }
    const rmsDb = sum > 0 ? 10 * Math.log10(sum / samples.length) : -Infinity;
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    this.level = {
      rmsDb: Number.isFinite(this.level.rmsDb) ? Math.max(rmsDb, this.level.rmsDb * 0.6 + rmsDb * 0.4) : rmsDb,
      peakDb: Math.max(peakDb, Number.isFinite(this.level.peakDb) ? this.level.peakDb - 1.5 : peakDb),
    };
    for (const l of this.listeners) l(samples, at);
    if (this.resampler && this.listeners16k.size) {
      const out = this.resampler.process(samples);
      if (out.length) for (const l of this.listeners16k) l(out, at);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    setOpenCount(Math.max(0, openCount - 1));
    this.node.port.postMessage("stop");
    try {
      this.source.disconnect();
      this.gain.disconnect();
      this.node.disconnect();
    } catch {
      // already disconnected
    }
    for (const t of this.stream.getTracks()) t.stop();
    this.listeners.clear();
    this.listeners16k.clear();
  }
}

/** Collects samples from a mic for a fixed time. */
export function recordFor(mic: MicInput, ms: number, onTick?: (remainingMs: number) => void): Promise<Float32Array> {
  return new Promise((resolve) => {
    const chunks: Float32Array[] = [];
    const started = performance.now();
    const off = mic.onSamples((s) => {
      chunks.push(s);
      const elapsed = performance.now() - started;
      onTick?.(Math.max(0, ms - elapsed));
      if (elapsed >= ms) {
        off();
        resolve(concat(chunks));
      }
    });
  });
}

export function concat(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
