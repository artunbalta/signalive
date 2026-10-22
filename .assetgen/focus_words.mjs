#!/usr/bin/env node
/**
 * When every word of the Focus room's three recordings starts, so a clench
 * can show exactly the words of the last ten seconds as they play back.
 * OpenAI's whisper-1 times the words it hears; those times are then laid
 * onto the script's own words (its spelling and punctuation), matched in
 * order, with any script word the recogniser wrote differently timed
 * between its neighbours.
 *
 *   OPENAI_API_KEY=... node .assetgen/focus_words.mjs
 *
 * Run after focus_voices.mjs. Writes public/media/focus/words.json:
 * per voice { d: seconds, w: [[word, start], ...] }.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MONOLOGUES } from "./focus_monologues.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "public", "media", "focus");
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error("OPENAI_API_KEY is not set.");
  process.exit(1);
}

const norm = (w) => w.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

async function heard(file) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(file)], { type: "audio/mpeg" }), "voice.mp3");
  form.append("model", "whisper-1");
  form.append("language", "en");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription failed: ${res.status}`);
  return (await res.json()).words;
}

/** Longest common subsequence of two token lists: pairs of matching indexes. */
function match(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const out = [];
for (const m of MONOLOGUES) {
  const file = join(dir, `${m.file}.mp3`);
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  const words = await heard(file);
  const script = m.text.split(/\s+/).filter(Boolean);
  const times = new Array(script.length).fill(null);
  for (const [i, j] of match(script.map(norm), words.map((w) => norm(w.word)))) times[i] = words[j].start;
  // Words the recogniser wrote differently: spread them between the matched ones.
  for (let i = 0; i < times.length; i++) {
    if (times[i] !== null) continue;
    let k = i;
    while (k < times.length && times[k] === null) k++;
    const from = i > 0 ? times[i - 1] : 0;
    const to = k < times.length ? times[k] : seconds;
    for (let n = i; n < k; n++) times[n] = from + ((to - from) * (n - i + 1)) / (k - i + 1);
  }
  // The recogniser's words can overlap by a few hundredths: keep them in order.
  for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1]);
  const matched = match(script.map(norm), words.map((w) => norm(w.word))).length;
  out.push({ d: Number(seconds.toFixed(2)), w: script.map((w, i) => [w, Number(times[i].toFixed(2))]) });
  console.log(`[focus_words] ${m.file}: ${script.length} words, ${matched} timed by the recogniser`);
}
writeFileSync(join(dir, "words.json"), JSON.stringify(out));
