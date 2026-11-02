#!/usr/bin/env node
/**
 * Copies the browser runtime assets that must be served as plain static files
 * into public/vendor. They are loaded by URL at runtime (WASM binaries, an
 * AudioWorklet module and the attention decoder's weights), so the bundler
 * must not touch them.
 *
 * Runs before every `next dev` and `next build` (predev / prebuild), which is
 * also what happens on Vercel. public/vendor is gitignored.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");

const files = [
  // onnxruntime-web, single threaded WASM backend. Loaded through the UMD
  // bundle so the bundler never sees the dynamic import inside it.
  ["onnxruntime-web/dist/ort.wasm.min.js", "ort/ort.wasm.min.js"],
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort/ort-wasm-simd-threaded.wasm"],
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "ort/ort-wasm-simd-threaded.mjs"],
  // RNNoise AudioWorklet and its two WASM builds (SIMD and plain).
  ["@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js", "rnnoise/rnnoise-worklet.js"],
  ["@sapphi-red/web-noise-suppressor/dist/rnnoise.wasm", "rnnoise/rnnoise.wasm"],
  ["@sapphi-red/web-noise-suppressor/dist/rnnoise_simd.wasm", "rnnoise/rnnoise_simd.wasm"],
  // MediaPipe face landmarks for head tracking on the Focus screen (SIMD and
  // plain builds; the module build is not needed).
  ["@mediapipe/tasks-vision/wasm/vision_wasm_internal.js", "mediapipe/vision_wasm_internal.js"],
  ["@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm", "mediapipe/vision_wasm_internal.wasm"],
  ["@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js", "mediapipe/vision_wasm_nosimd_internal.js"],
  ["@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm", "mediapipe/vision_wasm_nosimd_internal.wasm"],
];

// The learned attention decoder the earbuds use (research/aad/deep_export.py),
// from the repo root, where the research page serves it too. Loaded only when
// earbuds that send the voices' envelopes connect.
const shared = [["../public/research/neural.json", "attention/neural.json"]];

let copied = 0;
for (const [from, to] of shared) {
  const src = join(root, from);
  const dest = join(root, "public", "vendor", to);
  if (!existsSync(src)) {
    console.error(`[copy-vendor] missing ${from}. Run research/aad/deep_export.py, or check out the whole repo.`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  copied++;
}
for (const [from, to] of files) {
  const src = join(nm, from);
  const dest = join(root, "public", "vendor", to);
  if (!existsSync(src)) {
    console.error(`[copy-vendor] missing ${from}. Run npm install first.`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  copied++;
}
console.log(`[copy-vendor] ${copied} files copied to public/vendor`);
