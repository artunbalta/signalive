import { after } from "next/server";
import { z } from "zod";
import { readJson, requireConsent, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { getTts } from "@/lib/server/providers";
import type { TtsProvider } from "@/lib/server/providers/types";
import { rateLimit } from "@/lib/server/rate-limit";
import { speakLine, type ReplyEvent } from "@/lib/server/spoken-reply";
import type { Lang } from "@/lib/shared/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  /** What to say, such as a moment's title and summary. */
  text: z.string().trim().min(1).max(4000),
  lang: z.enum(["en", "tr"]),
});

type SpeakEvent = ReplyEvent | { t: "done"; totalMs: number };

/**
 * Text to speech for text the app already has (a moment read aloud):
 * sentence and audio events, as base64 PCM per sentence like every other
 * spoken reply, then done. The text is neither stored nor logged.
 */
export const POST = route("speak", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  rateLimit(user.auth.userId, "speak");
  const body = await readJson(req, Body);

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const events = speak(body.text, body.lang, getTts(), controller.signal);

  const counts = { sentences: 0, audioEvents: 0, totalMs: null as number | null };
  let error: string | null = null;
  after(() => {
    logMetric("speak.done", { lang: body.lang, chars: body.text.length, aborted: controller.signal.aborted, error, ...counts });
  });
  return ndjsonResponse(events, controller, (e) => {
    if (e.t === "sentence") counts.sentences++;
    else if (e.t === "audio") counts.audioEvents++;
    else if (e.t === "error") error = e.code;
    else if (e.t === "done") counts.totalMs = e.totalMs;
  });
});

async function* speak(text: string, lang: Lang, tts: TtsProvider, signal: AbortSignal): AsyncGenerator<SpeakEvent> {
  const t0 = performance.now();
  const result = yield* speakLine(text, { tts, lang, signal, since: () => performance.now() - t0, metric: "speak" });
  if (result.ok) yield { t: "done", totalMs: result.endMs };
}
