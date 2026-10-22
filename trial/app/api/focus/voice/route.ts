import { z } from "zod";
import { hedgeStream, retryableProviderError } from "@/lib/server/hedge";
import { requireConsent, requireUser, route } from "@/lib/server/http";
import { getTts } from "@/lib/server/providers";
import type { TtsProvider } from "@/lib/server/providers/types";
import { rateLimit } from "@/lib/server/rate-limit";
import { FOCUS_SPEAKERS, splitScript } from "@/lib/shared/focus";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Query = z.object({
  i: z.coerce.number().int().min(0).max(FOCUS_SPEAKERS.length - 1),
  lang: z.enum(["tr", "en"]),
});

/**
 * One Focus voice: a fixed script spoken by its own voice, as raw 16 bit PCM
 * (mono, sample rate in X-Sample-Rate). The scripts never change, so each is
 * synthesized once per server instance and kept in memory; nothing about
 * the user is in it.
 */
const cache = new Map<string, Promise<Uint8Array>>();

/** Pieces of a script synthesized side by side: one long request takes several times longer. */
const PIECES = 4;
/** Silence between pieces, so the joins keep a sentence's pause. */
const GAP_SEC = 0.12;

async function speak(tts: TtsProvider, text: string, opts: { lang: "tr" | "en"; voice?: string; style: string }): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const stream = hedgeStream((signal) => tts.synthesize(text, { ...opts, whisper: false, signal }), {
    afterMs: 4000,
    signal: new AbortController().signal,
    retryable: retryableProviderError,
  });
  for await (const chunk of stream) chunks.push(chunk);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0) & ~1);
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - offset);
    out.set(c.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

async function synthesize(tts: TtsProvider, i: number, lang: "tr" | "en"): Promise<Uint8Array> {
  const speaker = FOCUS_SPEAKERS[i]!;
  // ElevenLabs voices are configured per language; the OpenAI names do not apply there.
  const voice = tts.id === "elevenlabs" ? undefined : speaker.voice;
  const pieces = await Promise.all(splitScript(speaker.script[lang], PIECES).map((text) => speak(tts, text, { lang, voice, style: speaker.style })));
  const gap = Math.round(tts.sampleRate * GAP_SEC) * 2;
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length + gap, 0));
  let offset = 0;
  for (const p of pieces) {
    out.set(p, offset);
    offset += p.length + gap;
  }
  return out;
}

export const GET = route("focus.voice", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  const url = new URL(req.url);
  const { i, lang } = Query.parse({ i: url.searchParams.get("i"), lang: url.searchParams.get("lang") });
  const tts = getTts();
  const key = `${tts.id}:${tts.model}:${lang}:${i}`;
  let pcm = cache.get(key);
  if (!pcm) {
    // Only a new synthesis costs anything, so only that counts.
    rateLimit(user.auth.userId, "focus");
    pcm = synthesize(tts, i, lang);
    cache.set(key, pcm);
    pcm.catch(() => cache.delete(key));
  }
  const body = await pcm;
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Sample-Rate": String(tts.sampleRate),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
