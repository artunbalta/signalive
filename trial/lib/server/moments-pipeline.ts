import "server-only";
import { z } from "zod";
import {
  MomentContentSchema,
  type MomentContent,
  type MomentRequestMeta,
  type MomentStreamEvent,
} from "@/lib/shared/moments";
import type { Lang } from "@/lib/shared/types";
import { hedgePromise, retryableProviderError as retryable } from "@/lib/server/hedge";
import { localClock, normalizeIsoTime } from "@/lib/server/local-time";
import { logMetric } from "@/lib/server/log";
import {
  MOMENT_EMPTY_LINE,
  momentSavedLine,
  momentSystemPrompt,
  momentUserMessage,
  NOTES_RETRY_HINT,
} from "@/lib/server/prompts";
import type { AudioInput, LlmProvider, SttProvider, TtsProvider } from "@/lib/server/providers/types";
import { codeOf, logFailure, logHedge, speakLine, sttHedgeMs } from "@/lib/server/spoken-reply";

/**
 * A moment: the seconds a clench kept, recognized, written down by the
 * language model in the wearer's language, and confirmed aloud on request.
 * Streams transcript, moment, (sentences and audio), done. Nothing is
 * stored: the audio, its transcript and the moment serve this one response.
 */

/**
 * What the model is asked to produce. Free of length and count limits,
 * which structured output does not support; toMomentContent holds the
 * result to the contract afterwards.
 */
export const MomentContentWireSchema = z.object({
  title: z.string().describe("A few words, like the subject of an email"),
  summary: z.string().describe("Two or three plain sentences on what was said"),
  keyPoints: z.array(z.string()).describe("Up to four short facts worth keeping; empty if the summary holds them"),
  actionItems: z
    .array(
      z.object({
        text: z.string().describe("What someone said they or the wearer would do, as a short sentence"),
        due: z.string().nullable().describe("ISO 8601 date and time with offset, or a date alone; null when no time was said"),
      }),
    )
    .describe("Empty if nobody said they would do anything"),
  people: z.array(z.string()).describe("Names of people mentioned or speaking, as said"),
  topics: z.array(z.string()).describe("One to four short labels"),
  language: z.enum(["en", "tr"]),
});

export interface MomentInput {
  audio: AudioInput;
  meta: MomentRequestMeta;
}

export interface MomentDeps {
  stt: SttProvider;
  llm: LlmProvider;
  tts: TtsProvider;
}

/** Filled in as the moment is made, for the route's log line: timings and counts, never content. */
export interface MomentOutcome {
  sttMs: number | null;
  /** Since the request arrived, when the moment was ready. */
  momentMs: number | null;
  attempts: number;
}

/**
 * Writing a moment is one structured call of a couple of seconds; a second,
 * identical call goes out only when the first has said nothing for this long.
 */
const WRITE_HEDGE_MS = 12_000;

export async function* runMoment(
  input: MomentInput,
  deps: MomentDeps,
  signal: AbortSignal,
  outcome: MomentOutcome = { sttMs: null, momentMs: null, attempts: 0 },
): AsyncGenerator<MomentStreamEvent> {
  const t0 = performance.now();
  const since = () => performance.now() - t0;
  const { meta } = input;
  const lang = meta.replyLang;

  // A line in the wearer's language, as sentences and audio (the device
  // knows what it says). False when it failed or was aborted.
  const speak = async function* (line: string) {
    return (yield* speakLine(line, { tts: deps.tts, lang, signal, since, metric: "moments" })).ok;
  };

  // 1. Transcript
  let transcript: string;
  try {
    const r = await hedgePromise((s) => deps.stt.transcribeFile(input.audio, { language: meta.speechLang, signal: s }), {
      afterMs: sttHedgeMs(input.audio.durationMs),
      signal,
      retryable,
      onHedge: (cause) => logHedge("moments", "stt", deps.stt.id, cause),
    });
    transcript = r.text.trim();
    outcome.sttMs = since();
    yield { t: "transcript", text: transcript, language: r.language, provider: r.provider, model: r.model, ms: r.latencyMs };
  } catch (err) {
    if (!signal.aborted) logFailure("moments", "stt", err);
    yield { t: "error", code: codeOf(err) };
    return;
  }

  // 2. Nothing was said: there is nothing to keep.
  if (!transcript) {
    yield { t: "no_speech" };
    if (meta.speak && !(yield* speak(MOMENT_EMPTY_LINE[lang]))) return;
    yield { t: "done", totalMs: since() };
    return;
  }

  // 3. The moment, written by the model and held to the contract. After a
  // second unusable answer the request fails rather than keep a bad moment.
  const system = momentSystemPrompt({ lang, clock: localClock(meta.now, meta.timeZone), place: meta.place });
  const user = momentUserMessage(transcript);
  let content: MomentContent | null = null;
  let model = deps.llm.model;
  try {
    for (let attempt = 0; attempt < 2 && !content; attempt++) {
      outcome.attempts = attempt + 1;
      const answered = { model: deps.llm.model };
      const raw = await hedgePromise(
        (s) =>
          deps.llm.extractStructured({
            system,
            user: attempt === 0 ? user : user + NOTES_RETRY_HINT,
            schema: MomentContentWireSchema,
            maxTokens: 4000,
            signal: s,
            outcome: answered,
          }),
        { afterMs: WRITE_HEDGE_MS, signal, retryable, onHedge: (cause) => logHedge("moments", "llm", deps.llm.id, cause) },
      );
      content = toMomentContent(raw, lang, meta.timeZone);
      model = answered.model;
      if (!content) logMetric("moments.invalid", { attempt, model: deps.llm.model });
    }
  } catch (err) {
    if (!signal.aborted) logFailure("moments", "llm", err);
    yield { t: "error", code: codeOf(err) };
    return;
  }
  outcome.momentMs = since();
  if (!content) {
    yield { t: "error", code: "moment_invalid" };
    return;
  }
  yield { t: "moment", content, model };

  // 4. The spoken confirmation. A failure here ends the stream with an
  // error, but the moment above is complete and stays valid.
  if (meta.speak && !(yield* speak(momentSavedLine(content, lang)))) return;
  yield { t: "done", totalMs: since() };
}

/**
 * The model's answer held to the contract: whitespace tidied, text cut at
 * a word to its limit, lists capped and without repeats, times checked as
 * ISO 8601 (and given the wearer's offset when they came without), and the
 * language the one asked for. Null when it is unusable: no title or no
 * summary, or not the asked shape at all.
 */
export function toMomentContent(raw: unknown, lang: Lang, timeZone: string | null): MomentContent | null {
  const wire = MomentContentWireSchema.safeParse(raw);
  if (!wire.success) return null;
  const w = wire.data;
  const list = (items: string[], max: number, count: number) => {
    const seen = new Set<string>();
    return items
      .map((s) => clamp(s, max))
      .filter((s) => s && !seen.has(s.toLocaleLowerCase()) && seen.add(s.toLocaleLowerCase()))
      .slice(0, count);
  };
  const candidate: MomentContent = {
    title: clamp(w.title, 120).replace(/[\s.]+$/u, ""),
    summary: clamp(w.summary, 800),
    keyPoints: list(w.keyPoints, 240, 6),
    actionItems: w.actionItems
      .map((a) => ({ text: clamp(a.text, 240), due: normalizeIsoTime(a.due, timeZone) }))
      .filter((a) => a.text)
      .slice(0, 6),
    people: list(w.people, 60, 8),
    topics: list(w.topics, 40, 6),
    language: lang,
  };
  if (!candidate.title || !candidate.summary) return null;
  const parsed = MomentContentSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Trimmed, runs of whitespace as one space, and cut at a word to fit max characters. */
function clamp(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/u, "")}…`;
}
