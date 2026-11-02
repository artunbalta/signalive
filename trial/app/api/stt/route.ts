import { after } from "next/server";
import { z } from "zod";
import { hedgePromise, retryableProviderError as retryable } from "@/lib/server/hedge";
import { HttpError, json, readAudioFile, requireConsent, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { getStt } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rate-limit";
import { codeOf, logFailure, logHedge, sttHedgeMs } from "@/lib/server/spoken-reply";
import { decodeWav } from "@/lib/shared/audio/wav";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Meta = z.object({ speechLang: z.enum(["en", "tr", "auto"]) });

/** A spoken question is short; anything longer is not one. */
const MAX_SEC = 30;

/**
 * A short clip, recognized and nothing else: a question spoken to the agent
 * when the browser cannot stream to the recognizer itself. Answers with the
 * words ("" when there were none) and their language. Nothing is stored, and
 * the log line has timings only.
 */
export const POST = route("stt", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  rateLimit(user.auth.userId, "stt");
  if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) throw new HttpError(400, "audio_required");

  const form = await req.formData();
  let meta: z.infer<typeof Meta>;
  try {
    meta = Meta.parse(JSON.parse(String(form.get("meta") ?? "{}")));
  } catch {
    throw new HttpError(400, "invalid_request");
  }
  const data = await readAudioFile(form);
  let durationMs = 0;
  try {
    durationMs = decodeWav(data).durationMs;
  } catch {
    throw new HttpError(400, "audio_invalid");
  }
  if (durationMs > MAX_SEC * 1000 + 500) throw new HttpError(413, "audio_too_large");

  const stt = getStt();
  const t0 = performance.now();
  const outcome: { ms: number | null; error: string | null; empty: boolean } = { ms: null, error: null, empty: false };
  after(() => logMetric("stt.clip", { seconds: durationMs / 1000, speechLang: meta.speechLang, provider: stt.id, ...outcome }));
  try {
    const r = await hedgePromise((s) => stt.transcribeFile({ data, mimeType: "audio/wav", durationMs }, { language: meta.speechLang, signal: s }), {
      afterMs: sttHedgeMs(durationMs),
      signal: req.signal,
      retryable,
      onHedge: (cause) => logHedge("stt", "stt", stt.id, cause),
    });
    const text = r.text.trim();
    outcome.ms = Math.round(performance.now() - t0);
    outcome.empty = !text;
    return json({ text, language: r.language, provider: r.provider, model: r.model, ms: r.latencyMs });
  } catch (err) {
    outcome.error = codeOf(err);
    if (!req.signal.aborted) logFailure("stt", "stt", err);
    throw new HttpError(502, outcome.error);
  }
});
