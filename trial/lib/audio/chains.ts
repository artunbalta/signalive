"use client";

import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import type { ChainId } from "@/lib/shared/types";
import { hpfGate } from "./denoise";
import { resample } from "./resample";

/**
 * The lab's processing chains, applied offline to one recorded take so that
 * every chain sees the same utterance:
 *
 *   browser_default  the simultaneous capture with the browser's processing
 *   raw              the raw capture
 *   raw_rnnoise      raw, through RNNoise in its AudioWorklet (WASM)
 *   raw_hpf_gate     raw, through a 100 Hz high-pass and spectral gating
 *
 * Every output is 16 kHz mono, converted by our own resampler.
 */

const RNNOISE_RATE = 48000;
let wasm: Promise<ArrayBuffer> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * RNNoise in an OfflineAudioContext. The worklet compiles its WASM
 * asynchronously and outputs silence until it is ready, while offline
 * rendering does not wait for it. So rendering is suspended after two
 * quanta and resumed after a real time pause, and the output of a short
 * voiced preamble proves the processor ran before the take began. If it did
 * not, one retry with a longer pause, then an error (never silent output
 * passed off as a result).
 */
async function rnnoise(raw: Float32Array, rate: number): Promise<Float32Array> {
  wasm ??= loadRnnoise({ url: "/vendor/rnnoise/rnnoise.wasm", simdUrl: "/vendor/rnnoise/rnnoise_simd.wasm" });
  const binary = await wasm;
  const x = rate === RNNOISE_RATE ? raw : resample(raw, rate, RNNOISE_RATE);

  // 150 ms voiced preamble (a 150 Hz harmonic tone), then 50 ms of silence so
  // the processor's delay carries silence, not tone, into the take.
  const toneLen = Math.round(0.15 * RNNOISE_RATE);
  const pre = Math.round(0.2 * RNNOISE_RATE);
  const tail = Math.round(0.06 * RNNOISE_RATE);

  for (const pauseMs of [300, 1500]) {
    const total = pre + x.length + tail;
    const ctx = new OfflineAudioContext(1, total, RNNOISE_RATE);
    await ctx.audioWorklet.addModule("/vendor/rnnoise/rnnoise-worklet.js");
    const buf = ctx.createBuffer(1, total, RNNOISE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < toneLen; i++) {
      const t = i / RNNOISE_RATE;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 150 * h * t) / h;
      ch[i] = 0.05 * v;
    }
    ch.set(x, pre);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const node = new RnnoiseWorkletNode(ctx as unknown as AudioContext, { wasmBinary: binary, maxChannels: 1 });
    src.connect(node);
    node.connect(ctx.destination);
    src.start();
    void ctx.suspend((2 * 128) / RNNOISE_RATE).then(async () => {
      await sleep(pauseMs);
      await ctx.resume();
    });
    const out = (await ctx.startRendering()).getChannelData(0);
    node.destroy();

    let energy = 0;
    for (let i = Math.round(0.05 * RNNOISE_RATE); i < toneLen; i++) energy += out[i]! * out[i]!;
    if (energy > 1e-6) return resample(out.slice(pre, pre + x.length + tail), RNNOISE_RATE, 16000);
  }
  throw new Error("rnnoise_not_ready");
}

export interface Take {
  raw: Float32Array;
  rate: number;
  /** The simultaneous capture with browser processing; null if unavailable. */
  processed: Float32Array | null;
}

export async function runChains(
  take: Take,
  chains: readonly ChainId[],
): Promise<{ outputs: Partial<Record<ChainId, Float32Array>>; errors: Partial<Record<ChainId, string>> }> {
  const outputs: Partial<Record<ChainId, Float32Array>> = {};
  const errors: Partial<Record<ChainId, string>> = {};
  const raw16k = resample(take.raw, take.rate, 16000);
  for (const chain of chains) {
    try {
      switch (chain) {
        case "raw":
          outputs.raw = raw16k;
          break;
        case "browser_default":
          if (!take.processed) throw new Error("dual_capture_unavailable");
          outputs.browser_default = resample(take.processed, take.rate, 16000);
          break;
        case "raw_hpf_gate":
          outputs.raw_hpf_gate = hpfGate(raw16k);
          break;
        case "raw_rnnoise":
          outputs.raw_rnnoise = await rnnoise(take.raw, take.rate);
          break;
      }
    } catch (err) {
      errors[chain] = err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message : "failed";
    }
  }
  return { outputs, errors };
}
