import { after } from "next/server";
import { z } from "zod";
import { runAssistant, type AssistantOutcome } from "@/lib/server/assistant-pipeline";
import { HttpError, readAudioFile, requireConsent, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { searchNotesForAssistant } from "@/lib/server/notes-search";
import { getLlm, getStt, getTts } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rate-limit";
import type { NewUtterance } from "@/lib/server/store/types";
import { decodeWav } from "@/lib/shared/audio/wav";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Meta = z.object({
  turnId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  speechLang: z.enum(["en", "tr", "auto"]),
  whisper: z.boolean(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(12),
  now: z.string().max(80),
  timeZone: z.string().max(60).nullable(),
  /** Length of the user's speech, for the stored utterance. */
  speechMs: z.number().min(0).max(60_000),
  /** Set when the browser already has the transcript (live streaming). */
  transcript: z.string().max(2000).optional(),
  sttProvider: z.string().max(40).optional(),
  sttModel: z.string().max(80).optional(),
});

/**
 * One spoken exchange. Either a transcript (the browser streamed the audio
 * to the recognizer) or a 16 kHz WAV (recognized here). The response is
 * newline delimited JSON: transcript, text deltas, sentences, PCM audio, done.
 */
export const POST = route("assistant", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  const { store, auth } = user;
  rateLimit(auth.userId, "assistant");

  let meta: z.infer<typeof Meta>;
  let audio: { data: Uint8Array; mimeType: string; durationMs: number } | undefined;
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData();
    meta = Meta.parse(JSON.parse(String(form.get("meta") ?? "{}")));
    const data = await readAudioFile(form);
    let durationMs = 0;
    try {
      durationMs = decodeWav(data).durationMs;
    } catch {
      throw new HttpError(400, "audio_invalid");
    }
    if (durationMs > 30_000) throw new HttpError(413, "audio_too_large");
    audio = { data, mimeType: "audio/wav", durationMs };
  } else {
    meta = Meta.parse(await req.json());
    if (!meta.transcript) throw new HttpError(400, "missing_transcript");
  }

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const outcome: AssistantOutcome = { transcript: "", reply: "", language: null };
  const stt = getStt();
  const receivedAt = Date.now();

  const events = runAssistant(
    {
      transcript: meta.transcript,
      audio,
      speechLang: meta.speechLang,
      whisper: meta.whisper,
      history: meta.history,
      now: meta.now,
      timeZone: meta.timeZone,
    },
    {
      stt,
      llm: getLlm(),
      tts: getTts(),
      searchNotes: (q) => searchNotesForAssistant(store, q, controller.signal),
    },
    controller.signal,
    outcome,
  );

  let timings: Record<string, number | null> = {};

  // Runs after the response has finished streaming.
  after(async () => {
    logMetric("assistant.turn", {
      mode: audio ? "batch" : "stream",
      whisper: meta.whisper,
      aborted: controller.signal.aborted,
      ...timings,
    });
    if (!outcome.transcript || !meta.sessionId) return;
    const endedAt = new Date(receivedAt).toISOString();
    const startedAt = new Date(receivedAt - meta.speechMs).toISOString();
    const rows: NewUtterance[] = [
      {
        sessionId: meta.sessionId,
        source: "assistant",
        role: "user",
        text: outcome.transcript,
        language: outcome.language,
        startedAt,
        endedAt,
        durationMs: Math.round(meta.speechMs),
        sttProvider: audio ? stt.id : (meta.sttProvider ?? null),
        sttModel: audio ? stt.model : (meta.sttModel ?? null),
        confidence: null,
        audioObjectId: null,
      },
    ];
    if (outcome.reply) {
      const now = new Date().toISOString();
      rows.push({ ...rows[0]!, role: "assistant", text: outcome.reply, startedAt: endedAt, endedAt: now, durationMs: 0, sttProvider: null, sttModel: null });
    }
    await store.insertUtterances(rows).catch(() => undefined);
  });

  return ndjsonResponse(events, controller, (e) => {
    if (e.t === "done") timings = { ...e.server };
  });
});
