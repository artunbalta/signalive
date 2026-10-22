import { after } from "next/server";
import { z } from "zod";
import { runAssistant } from "@/lib/server/assistant-pipeline";
import { HttpError, readAudioFile, requireConsent, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { getLlm, getStt, getTts } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rate-limit";
import { decodeWav } from "@/lib/shared/audio/wav";
import { REWIND_BUFFER_SEC } from "@/lib/shared/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Meta = z.object({
  /** What to expect in the audio; "auto" lets the recognizer decide. */
  speechLang: z.enum(["en", "tr", "auto"]),
  /** The language to tell the user in. */
  replyLang: z.enum(["en", "tr"]),
  whisper: z.boolean(),
  seconds: z.number().min(1).max(REWIND_BUFFER_SEC),
  now: z.string().max(80),
  timeZone: z.string().max(60).nullable(),
});

/**
 * Rewind: the last seconds the microphone heard, as a 16 kHz WAV, recognized
 * and recapped in the user's language, streamed back like an assistant
 * reply. The audio and its transcript serve this one reply: nothing is
 * stored, and the log line has timings only.
 */
export const POST = route("rewind", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  rateLimit(user.auth.userId, "rewind");
  if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) throw new HttpError(400, "audio_required");

  const form = await req.formData();
  const meta = Meta.parse(JSON.parse(String(form.get("meta") ?? "{}")));
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
  const events = runAssistant(
    {
      audio: { data, mimeType: "audio/wav", durationMs },
      speechLang: meta.speechLang,
      whisper: meta.whisper,
      history: [],
      now: meta.now,
      timeZone: meta.timeZone,
      mode: "rewind",
      replyLang: meta.replyLang,
      seconds: meta.seconds,
    },
    { stt: getStt(), llm: getLlm(), tts: getTts(), searchNotes: async () => "" },
    controller.signal,
  );

  let timings: Record<string, number | null> = {};
  let empty = false;
  after(() => {
    logMetric("rewind.turn", { seconds: meta.seconds, empty, aborted: controller.signal.aborted, ...timings });
  });
  return ndjsonResponse(events, controller, (e) => {
    if (e.t === "transcript") empty = !e.text;
    if (e.t === "done") timings = { ...e.server };
  });
});
