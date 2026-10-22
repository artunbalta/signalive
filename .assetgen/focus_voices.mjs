#!/usr/bin/env node
/**
 * The audio for the Focus room behind the hero: three monologues, one voice
 * each, and a spoken recap of each. OpenAI gpt-4o-mini-tts with the same
 * voices and speaking styles as the web trial (trial/lib/shared/focus.ts).
 * The recaps must match focusRoom.speakers[].recap in lib/copy.ts word for
 * word; the script checks that before it spends anything.
 *
 *   OPENAI_API_KEY=... node .assetgen/focus_voices.mjs
 *
 * Output: public/media/focus/*.mp3, mono 24 kHz, loudness normalised to
 * -20 LUFS so no voice is louder than another, 64 kbps.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "media", "focus");
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error("OPENAI_API_KEY is not set.");
  process.exit(1);
}

const MONOLOGUES = [
  {
    file: "emma",
    voice: "coral",
    style: "Warm and lively, telling a close friend about a trip, smiling as she talks.",
    text: "You won't believe it, we were up at four in the morning in Cappadocia. The van picked us up at a quarter to five, and our guide, Hasan, was the sweetest man. The balloon lifted off at exactly six thirty, and as the sun came up behind Uçhisar about a hundred balloons rose at once. They said we got to a thousand meters, I couldn't even look down. When we landed, the pilot opened champagne for everyone and handed out medals, can you imagine, medals! Next time I'm definitely going in October, the weather was perfect. You'll come too, right? This time let's hike Pigeon Valley as well.",
  },
  {
    file: "daniel",
    voice: "onyx",
    style: "Confident and quick, pitching an idea to a friend with real enthusiasm.",
    text: "So here's the idea: you clip a tiny sensor onto your plant pot, and when the soil dries out, your phone gets a notification. That simple. But here's the real thing, the sensor knows the plant, so you don't water basil like a cactus. Twelve hundred people downloaded it in the first month, without a single ad. We're thinking four ninety-nine a month, and the first sensor is free. Next Tuesday I'm meeting an investor, she gave us forty minutes. Before that we need to go through the deck once more, especially the numbers. If we finish the demo video by Thursday, that would be great.",
  },
  {
    file: "barista",
    voice: "verse",
    style: "An upbeat café barista calling out finished orders across a busy counter, loud and friendly.",
    text: "Selin, oat milk latte! Two americanos, one iced, whose was that? Kevin, your filter coffee's on the counter. And a caramel frappé, with the extra syrup you asked for. Folks, croissants are out of the oven in five minutes, almond ones too. If you're paying by card, pick up on this side, please. Ellie, hot chocolate, I put cinnamon on top! Double espresso, no sugar, by the register. One medium chai tea latte, for Ben. Thanks, have a good one!",
  },
];

const RECAP_VOICE = { voice: "marin", style: "Calm and clear, telling a friend in a few words what someone just said." };

// The recaps are the page's own copy: read them from lib/copy.ts.
const copy = readFileSync(join(root, "lib", "copy.ts"), "utf8");
const block = copy.slice(copy.indexOf("export const focusRoom"), copy.indexOf("export const oneClench"));
const recaps = [...block.matchAll(/recap:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
if (recaps.length !== MONOLOGUES.length) {
  console.error(`expected ${MONOLOGUES.length} recaps in lib/copy.ts, found ${recaps.length}`);
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
for (const [i, m] of MONOLOGUES.entries()) {
  encode(await speak(m.text, m.voice, m.style), m.file);
  encode(await speak(recaps[i], RECAP_VOICE.voice, RECAP_VOICE.style), `recap-${m.file}`);
  console.log(`[focus_voices] ${m.file}.mp3 and recap-${m.file}.mp3`);
}
