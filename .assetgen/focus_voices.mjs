#!/usr/bin/env node
/**
 * The audio for the Focus room at the top of the page: three monologues,
 * one voice each. OpenAI gpt-4o-mini-tts with the same voices and speaking
 * styles as the web trial (trial/lib/shared/focus.ts); the scripts are in
 * focus_monologues.mjs.
 *
 *   OPENAI_API_KEY=... node .assetgen/focus_voices.mjs
 *   OPENAI_API_KEY=... node .assetgen/focus_words.mjs
 *
 * The second step times every word of the new recordings, which a clench
 * needs to show what was said; run it whenever the voices change.
 *
 * Output: public/media/focus/*.mp3, mono 24 kHz, loudness normalised to
 * -20 LUFS so no voice is louder than another, 64 kbps.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MONOLOGUES } from "./focus_monologues.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "media", "focus");
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error("OPENAI_API_KEY is not set.");
  process.exit(1);
}

async function speak(text, voice, style) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions: style, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`speech request failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function encode(pcm, name) {
  const tmp = mkdtempSync(join(tmpdir(), "focus-"));
  const raw = join(tmp, "in.pcm");
  writeFileSync(raw, pcm);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw,
    "-af", "loudnorm=I=-20:TP=-2:LRA=11",
    "-ar", "24000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k",
    join(out, `${name}.mp3`),
  ]);
  rmSync(tmp, { recursive: true, force: true });
}

mkdirSync(out, { recursive: true });
for (const m of MONOLOGUES) {
  encode(await speak(m.text, m.voice, m.style), m.file);
  console.log(`[focus_voices] ${m.file}.mp3`);
}
