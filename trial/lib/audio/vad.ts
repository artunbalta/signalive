"use client";

import type * as Ort from "onnxruntime-web";
import type { MicInput } from "./mic";
import { VAD_NORMAL, VadSegmenter, type VadEvent, type VadOptions } from "./vad-segmenter";

/**
 * Silero VAD (v6, MIT, github.com/snakers4/silero-vad) on onnxruntime-web.
 *
 * ONNX Runtime is loaded from its UMD build in public/vendor (copied from
 * node_modules at build time) with a plain script tag, so the bundler never
 * sees its dynamic WASM import. Single threaded: no cross-origin isolation
 * needed. The model takes 512 new samples at 16 kHz plus the last 64 samples
 * of the previous frame as context, and carries a state tensor between calls.
 */

type OrtModule = typeof Ort;
declare global {
  interface Window {
    ort?: OrtModule;
  }
}

const ORT_SCRIPT = "/vendor/ort/ort.wasm.min.js";
const MODEL_URL = "/models/silero_vad.onnx";
const FRAME = 512;
const CONTEXT = 64;

let ortLoading: Promise<OrtModule> | null = null;

function loadOrt(): Promise<OrtModule> {
  ortLoading ??= new Promise<OrtModule>((resolve, reject) => {
    if (window.ort) return resolve(window.ort);
    const s = document.createElement("script");
    s.src = ORT_SCRIPT;
    s.async = true;
    s.onload = () => (window.ort ? resolve(window.ort) : reject(new Error("ort missing")));
    s.onerror = () => reject(new Error("ort failed to load"));
    document.head.appendChild(s);
  }).then((ort) => {
    ort.env.wasm.wasmPaths = "/vendor/ort/";
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    return ort;
  });
  ortLoading.catch(() => (ortLoading = null));
  return ortLoading;
}

export class SileroVad {
  private context = new Float32Array(CONTEXT);
  private state: Ort.Tensor;

  private constructor(
    private readonly ort: OrtModule,
    private readonly session: Ort.InferenceSession,
    private readonly sr: Ort.Tensor,
  ) {
    this.state = this.zeroState();
  }

  private zeroState(): Ort.Tensor {
    return new this.ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  }

  static async load(): Promise<SileroVad> {
    const ort = await loadOrt();
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error("model fetch failed");
    const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
      executionProviders: ["wasm"],
    });
    const sr = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);
    return new SileroVad(ort, session, sr);
  }

  /** Speech probability for 512 new samples at 16 kHz. */
  async process(frame: Float32Array): Promise<number> {
    const input = new Float32Array(CONTEXT + FRAME);
    input.set(this.context, 0);
    input.set(frame, CONTEXT);
    this.context = frame.slice(FRAME - CONTEXT);
    const out = await this.session.run({
      input: new this.ort.Tensor("float32", input, [1, CONTEXT + FRAME]),
      state: this.state,
      sr: this.sr,
    });
    this.state = out.stateN as Ort.Tensor;
    return (out.output as Ort.Tensor).data[0] as number;
  }

  reset() {
    this.context = new Float32Array(CONTEXT);
    this.state = this.zeroState();
  }
}

let shared: Promise<SileroVad> | null = null;

/** One model instance per page; loading starts on first use. */
export function loadVad(): Promise<SileroVad> {
  shared ??= SileroVad.load();
  shared.catch(() => (shared = null));
  return shared;
}

export interface VadFrame {
  prob: number;
  at: number;
}

/**
 * Runs the model on a microphone's 16 kHz stream and reports utterances.
 * Frames are processed strictly in order; the model is far faster than real
 * time, so nothing is dropped in practice.
 */
export class VadRunner {
  readonly segmenter: VadSegmenter;
  private pending = new Float32Array(0);
  private chain: Promise<void> = Promise.resolve();
  private off: (() => void) | null = null;
  private paused = false;
  /** Latest probability, for meters and endpointing. */
  last: VadFrame = { prob: 0, at: 0 };
  lastSpeechAt = 0;

  constructor(
    private readonly vad: SileroVad,
    private readonly onEvent: (e: VadEvent) => void,
    opts: VadOptions = VAD_NORMAL,
  ) {
    this.segmenter = new VadSegmenter(opts);
  }

  attach(mic: MicInput) {
    this.detach();
    this.vad.reset();
    this.segmenter.reset();
    this.off = mic.on16k((samples, at) => this.feed(samples, at));
  }

  detach() {
    this.off?.();
    this.off = null;
    this.pending = new Float32Array(0);
  }

  /** While paused, frames are dropped and any utterance in progress is discarded. */
  setPaused(p: boolean) {
    this.paused = p;
    if (p) {
      this.segmenter.reset();
      this.vad.reset();
    }
  }

  private feed(samples: Float32Array, at: number) {
    if (this.paused) return;
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);
    let offset = 0;
    const total = merged.length;
    while (total - offset >= FRAME) {
      const frame = merged.slice(offset, offset + FRAME);
      // Time of this frame's end, counted back from the chunk's arrival.
      const frameAt = at - ((total - offset - FRAME) / 16000) * 1000;
      offset += FRAME;
      this.chain = this.chain.then(async () => {
        if (this.paused) return;
        const prob = await this.vad.process(frame);
        this.last = { prob, at: frameAt };
        if (prob >= this.segmenter.options.positiveThreshold) this.lastSpeechAt = frameAt;
        for (const e of this.segmenter.push(frame, prob, frameAt)) this.onEvent(e);
      });
    }
    this.pending = merged.slice(offset);
  }
}
