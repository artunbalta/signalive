import "server-only";
import { guessLanguage } from "@/lib/shared/lang-detect";
import type { Lang, SpeechLang } from "@/lib/shared/types";
import { hedgePromise, hedgeStream, retryableProviderError as retryable } from "@/lib/server/hedge";
import {
  assistantSystemPrompt,
  REWIND_EMPTY_LINE,
  rewindSystemPrompt,
  rewindUserMessage,
} from "@/lib/server/prompts";
import type { AudioInput, ChatTurn, LlmProvider, SttProvider, TtsProvider } from "@/lib/server/providers/types";
import {
  codeOf,
  LLM_HEDGE_MS,
  logFailure,
  logHedge,
  spoken,
  SpokenReply,
  sttHedgeMs,
} from "@/lib/server/spoken-reply";

/**
 * One assistant turn: (speech to text) -> LLM stream -> sentence chunks ->
 * TTS, emitted as events while they happen. How a reply's sentences are
 * synthesized and kept in order is in spoken-reply.ts.
 */

export interface ServerTimings {
  sttMs: number | null;
  llmFirstTokenMs: number | null;
  firstSentenceMs: number | null;
  ttsFirstAudioMs: number | null;
  totalMs: number;
}

export type AssistantEvent =
  | { t: "transcript"; text: string; language: Lang | null; provider: string; model: string; ms: number }
  | { t: "no_speech" }
  | { t: "tool"; name: string; state: "start" | "end" }
  | { t: "text"; delta: string }
  | { t: "sentence"; i: number; text: string }
  | { t: "audio"; i: number; sr: number; pcm: string }
  | { t: "done"; reply: string; language: Lang; refusal: boolean; server: ServerTimings; llmModel: string; ttsProvider: string }
  | { t: "error"; code: string };

export interface AssistantInput {
  transcript?: string;
  audio?: AudioInput;
  speechLang: SpeechLang;
  whisper: boolean;
  history: ChatTurn[];
  now: string;
  timeZone: string | null;
  /**
   * "rewind": the audio is what was said around the user, not a question.
   * The reply recaps it in replyLang without tools, and a rewind with no
   * speech in it gets a spoken line instead of no_speech.
   */
  mode?: "ask" | "rewind";
  /** Rewind only: the language of the recap. */
  replyLang?: Lang;
  /** Rewind only: how many seconds were rewound. */
  seconds?: number;
}

export interface AssistantDeps {
  stt: SttProvider;
  llm: LlmProvider;
  tts: TtsProvider;
  searchNotes: (query: string) => Promise<string>;
}

export interface AssistantOutcome {
  transcript: string;
  reply: string;
  language: Lang | null;
}

export async function* runAssistant(
  input: AssistantInput,
  deps: AssistantDeps,
  signal: AbortSignal,
  outcome: AssistantOutcome = { transcript: "", reply: "", language: null },
): AsyncGenerator<AssistantEvent> {
  const t0 = performance.now();
  const since = () => performance.now() - t0;
  const timings: ServerTimings = { sttMs: null, llmFirstTokenMs: null, firstSentenceMs: null, ttsFirstAudioMs: null, totalMs: 0 };

  // 1. Transcript
  let transcript = input.transcript?.trim() ?? "";
  let userLang: Lang | null = input.speechLang === "auto" ? null : input.speechLang;
  if (input.audio) {
    const audio = input.audio;
    try {
      const r = await hedgePromise((s) => deps.stt.transcribeFile(audio, { language: input.speechLang, signal: s }), {
        afterMs: sttHedgeMs(audio.durationMs),
        signal,
        retryable,
        onHedge: (cause) => logHedge("assistant", "stt", deps.stt.id, cause),
      });
      transcript = r.text.trim();
      userLang = r.language ?? userLang;
      timings.sttMs = since();
      yield { t: "transcript", text: transcript, language: r.language, provider: r.provider, model: r.model, ms: r.latencyMs };
    } catch (err) {
      if (!signal.aborted) logFailure("assistant", "stt", err);
      yield { t: "error", code: codeOf(err) };
      return;
    }
  }
  const rewind = input.mode === "rewind";
  if (!transcript && !rewind) {
    yield { t: "no_speech" };
    return;
  }
  const lang: Lang = rewind ? (input.replyLang ?? userLang ?? "en") : (userLang ?? guessLanguage(transcript));
  outcome.transcript = transcript;
  outcome.language = lang;

  // 2. The reply: LLM and TTS interleaved.
  const system = rewind
    ? rewindSystemPrompt({ lang, seconds: input.seconds ?? 15, now: input.now, timeZone: input.timeZone })
    : assistantSystemPrompt({ whisper: input.whisper, lang, now: input.now, timeZone: input.timeZone });
  const reply = new SpokenReply({
    tts: deps.tts,
    // A recap is in the language asked for, even when it quotes another.
    lang: rewind ? lang : null,
    userLang: lang,
    whisper: input.whisper,
    signal,
    since,
    metric: "assistant",
  });
  const result = yield* reply.run((s) =>
    rewind && !transcript
      ? spoken(REWIND_EMPTY_LINE[lang])
      : hedgeStream(
          (h) =>
            deps.llm.streamAssistantReply({
              system,
              history: rewind ? [] : input.history,
              user: rewind ? rewindUserMessage(transcript) : transcript,
              maxTokens: rewind ? 300 : input.whisper ? 200 : 700,
              tools: rewind ? undefined : { searchNotes: deps.searchNotes },
              signal: h,
            }),
          { afterMs: LLM_HEDGE_MS, signal: s, retryable, onHedge: (cause) => logHedge("assistant", "llm", deps.llm.id, cause) },
        ),
  );
  if (!result.ok) return;
  Object.assign(timings, result.timings);
  timings.totalMs = result.endMs;
  outcome.reply = result.reply;
  yield {
    t: "done",
    reply: result.reply,
    language: result.language,
    refusal: result.refusal,
    server: timings,
    llmModel: deps.llm.model,
    ttsProvider: deps.tts.id,
  };
}
