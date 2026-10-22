import { z } from "zod";
import * as env from "@/lib/server/env";
import { HttpError, json, readAudioFile, requireConsent, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { getStt } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rate-limit";
import { decodeWav } from "@/lib/shared/audio/wav";
import { MAX_SEGMENT_MS } from "@/lib/shared/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Meta = z.object({
  sessionId: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  speechLang: z.enum(["en", "tr", "auto"]),
  keepAudio: z.boolean(),
});

/**
 * One recorder segment (a VAD utterance, 16 kHz WAV): transcribe it and store
 * the transcript. The raw audio is stored only if the request asks for it AND
 * the user's latest raw audio consent is granted; it then expires on its own.
 */
export const POST = route("recorder.segment", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  const { store, auth } = user;
  rateLimit(auth.userId, "stt");
  const form = await req.formData();
  const meta = Meta.parse(JSON.parse(String(form.get("meta") ?? "{}")));
  const data = await readAudioFile(form);
  let durationMs: number;
  let sampleRate: number;
  try {
    const wav = decodeWav(data);
    durationMs = wav.durationMs;
    sampleRate = wav.sampleRate;
  } catch {
    throw new HttpError(400, "audio_invalid");
  }
  if (durationMs > MAX_SEGMENT_MS + 2000) throw new HttpError(413, "audio_too_large");

  const stt = getStt();
  const result = await stt.transcribeFile({ data, mimeType: "audio/wav", durationMs }, { language: meta.speechLang, signal: req.signal });
  logMetric("recorder.segment", { provider: stt.id, sttMs: result.latencyMs, audioMs: durationMs, empty: !result.text });
  if (!result.text) return json({ utterance: null });

  let audioObjectId: string | null = null;
  if (meta.keepAudio) {
    const consent = (await store.currentConsents()).raw_audio_retention;
    if (consent?.granted) {
      const expiresAt = new Date(Date.now() + env.retention.rawAudioDays * 86_400_000).toISOString();
      const obj = await store.putAudio({ kind: "recorder", bytes: data, durationMs, sampleRate, expiresAt });
      audioObjectId = obj.id;
    }
  }

  const [utterance] = await store.insertUtterances([
    {
      sessionId: meta.sessionId,
      source: "recorder",
      role: "user",
      text: result.text,
      language: result.language,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      durationMs: Math.round(durationMs),
      sttProvider: result.provider,
      sttModel: result.model,
      confidence: result.confidence,
      audioObjectId,
    },
  ]);
  return json({ utterance }, 201);
});
