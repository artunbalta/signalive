#!/usr/bin/env node
/**
 * Builds the speech fixtures the end to end tests feed to Chromium's fake
 * microphone (--use-file-for-fake-audio-capture). macOS only: it uses the
 * system voices through `say` (Samantha for English, Yelda for Turkish) and
 * ffmpeg to resample and pad. Output: tests/fixtures/audio/*.wav (gitignored).
 *
 * Each file is silence, one utterance, then a longer silence, so a looping
 * fake microphone gives the voice detector a clear start and end.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tests", "fixtures", "audio");
mkdirSync(out, { recursive: true });

const fixtures = [
  { name: "en-what-can-you-do", voice: "Samantha", text: "What can you do?", lead: 1.5, tail: 4 },
  { name: "en-notes-question", voice: "Samantha", text: "What did I say about the budget review in my notes?", lead: 1.5, tail: 4 },
  { name: "tr-yarin-hava", voice: "Yelda", text: "Merhaba, yarın İstanbul'da hava nasıl olacak?", lead: 1.5, tail: 4 },
  { name: "en-recorder-monologue", voice: "Samantha", text: "Let's move the budget review to Friday at three. Elif will send the slides, and I need to call the venue tomorrow morning.", lead: 1, tail: 5 },
];

for (const f of fixtures) {
  const aiff = join(out, `${f.name}.aiff`);
  const wav = join(out, `${f.name}.wav`);
  execFileSync("say", ["-v", f.voice, "-o", aiff, f.text]);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-t", String(f.lead), "-i", "anullsrc=r=48000:cl=mono",
    "-i", aiff,
    "-f", "lavfi", "-t", String(f.tail), "-i", "anullsrc=r=48000:cl=mono",
    "-filter_complex", "[1]aresample=48000,aformat=channel_layouts=mono[s];[0][s][2]concat=n=3:v=0:a=1",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav,
  ]);
  rmSync(aiff);
  console.log(`[test-audio] ${wav}`);
}
