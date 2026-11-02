import { after } from "next/server";
import { HttpError, readAudioFile, requireConsent, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { runMoment, type MomentOutcome } from "@/lib/server/moments-pipeline";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { getLlm, getStt, getTts } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rate-limit";
import { decodeWav } from "@/lib/shared/audio/wav";
import { REWIND_BUFFER_SEC } from "@/lib/shared/constants";
import { MomentRequestMetaSchema, type MomentRequestMeta } from "@/lib/shared/moments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A moment: the seconds a clench kept, as a 16 kHz WAV, recognized and
 * written down (title, summary, key points, action items, people) in the
 * wearer's language, streamed back with a spoken confirmation on request.
 * See lib/shared/moments.ts for the stream. Nothing is stored: the audio,
 * the transcript and the moment serve this one response, and the log line
 * has timings and counts only.
 */
export const POST = route("moments", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  rateLimit(user.auth.userId, "moments");
  if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) throw new HttpError(400, "audio_required");

  const form = await req.formData();
  let meta: MomentRequestMeta;
  try {
    meta = MomentRequestMetaSchema.parse(JSON.parse(String(form.get("meta") ?? "{}")));
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
  if (durationMs > REWIND_BUFFER_SEC * 1000 + 500) throw new HttpError(413, "audio_too_large");

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const outcome: MomentOutcome = { sttMs: null, momentMs: null, attempts: 0 };
  const events = runMoment(
    { audio: { data, mimeType: "audio/wav", durationMs }, meta },
    { stt: getStt(), llm: getLlm(), tts: getTts() },
    controller.signal,
    outcome,
  );

  const counts = { empty: false, keyPoints: 0, actionItems: 0, people: 0, audioEvents: 0, totalMs: null as number | null };
  let error: string | null = null;
  after(() => {
    logMetric("moments.made", {
      trigger: meta.trigger,
      speechLang: meta.speechLang,
      replyLang: meta.replyLang,
      speak: meta.speak,
      place: meta.place !== null,
      seconds: durationMs / 1000,
      aborted: controller.signal.aborted,
      error,
      attempts: outcome.attempts,
      sttMs: outcome.sttMs,
      momentMs: outcome.momentMs,
      ...counts,
    });
  });
  return ndjsonResponse(events, controller, (e) => {
    if (e.t === "transcript") counts.empty = !e.text;
    else if (e.t === "moment") {
      counts.keyPoints = e.content.keyPoints.length;
      counts.actionItems = e.content.actionItems.length;
      counts.people = e.content.people.length;
    } else if (e.t === "audio") counts.audioEvents++;
    else if (e.t === "error") error = e.code;
    else if (e.t === "done") counts.totalMs = e.totalMs;
  });
});
