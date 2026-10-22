import "server-only";
import { guessLanguage } from "@/lib/shared/lang-detect";
import { SentenceChunker } from "@/lib/shared/sentences";
import type { Lang, SpeechLang } from "@/lib/shared/types";
import { hedgePromise, hedgeStream, retryableProviderError as retryable } from "@/lib/server/hedge";
import { logError, logMetric } from "@/lib/server/log";
import { AsyncQueue } from "@/lib/server/providers/http";
import {
  assistantSystemPrompt,
  REFUSAL_LINE,
  REWIND_EMPTY_LINE,
  rewindSystemPrompt,
  rewindUserMessage,
} from "@/lib/server/prompts";
import {
  ProviderError,
  type AudioInput,
  type ChatTurn,
  type LlmEvent,
  type LlmProvider,
  type SttProvider,
  type TtsProvider,
} from "@/lib/server/providers/types";

/**
 * One assistant turn: (speech to text) -> LLM stream -> sentence chunks ->
 * TTS, emitted as events while they happen. TTS for a sentence starts as
 * soon as the sentence is complete and a slot is free, so the next sentence
 * synthesizes while the current one plays; audio events still come out
 * strictly in order.
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

interface TtsJob {
  text: string;
  chunks: Uint8Array[];
  done: boolean;
  error: unknown;
}

/**
 * Sentences synthesizing at once: the one being heard and the next. More
 * does not make the reply start sooner, and a burst of parallel requests
 * is what providers throttle.
 */
const TTS_CONCURRENCY = 2;

/**
 * When a request has produced nothing after this long, an identical one is
 * sent alongside it (see hedge.ts). Usual times to first output, measured
 * 2026-10-21: speech about 0.5 s (slowest healthy 1.4 s), Claude 1.2 s
 * (slowest 1.5 s), transcription of 9 s of audio 0.7 to 1.9 s.
 */
const TTS_HEDGE_MS = 2000;
const LLM_HEDGE_MS = 5000;
const sttHedgeMs = (audioMs: number) => 2500 + 0.15 * audioMs;

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
        onHedge: (cause) => logHedge("stt", deps.stt.id, cause),
      });
      transcript = r.text.trim();
      userLang = r.language ?? userLang;
      timings.sttMs = since();
      yield { t: "transcript", text: transcript, language: r.language, provider: r.provider, model: r.model, ms: r.latencyMs };
    } catch (err) {
      if (!signal.aborted) logFailure("stt", err);
      yield { t: "error", code: codeOf(err) };
      return;
    }
  }
  const rewind = input.mode === "rewind";
  if (!transcript && !rewind) {
    yield { t: "no_speech" };
    return;
  }
  userLang = rewind ? (input.replyLang ?? userLang ?? "en") : (userLang ?? guessLanguage(transcript));
  outcome.transcript = transcript;
  outcome.language = userLang;

  // 2. LLM and TTS, interleaved through one queue. The first failure ends
  // the turn: it is the last event, and the LLM and TTS calls are aborted.
  const events = new AsyncQueue<AssistantEvent>();
  const inner = new AbortController();
  const forwardAbort = () => inner.abort();
  signal.addEventListener("abort", forwardAbort, { once: true });
  const jobs: TtsJob[] = [];
  let nextJob = 0;
  let running = 0;
  let llmDone = false;
  let replyLang: Lang | null = null;
  let reply = "";
  let refusal = false;
  let failed = false;

  // Everything that can unblock the emitter (a new job, a chunk, a finished
  // job, the end of the LLM stream, a failure) calls wake().
  let waiting: (() => void) | null = null;
  const wake = () => {
    const w = waiting;
    waiting = null;
    w?.();
  };
  const sleep = () => new Promise<void>((r) => (waiting = r));
  inner.signal.addEventListener("abort", wake, { once: true });

  const fail = (err: unknown, stage: Stage) => {
    if (failed) return;
    failed = true;
    if (!signal.aborted) {
      logFailure(stage, err);
      events.push({ t: "error", code: codeOf(err) });
    }
    events.close();
    inner.abort();
    wake();
  };

  const synthesize = async (job: TtsJob) => {
    running++;
    try {
      // Hedged until the first audio arrives; after that a failure ends the
      // turn, since a second attempt would repeat what was already heard.
      const audio = hedgeStream((s) => deps.tts.synthesize(job.text, { lang: replyLang!, whisper: input.whisper, signal: s }), {
        afterMs: TTS_HEDGE_MS,
        signal: inner.signal,
        retryable,
        onHedge: (cause) => logHedge("tts", deps.tts.id, cause),
      });
      for await (const chunk of audio) {
        job.chunks.push(chunk);
        wake();
      }
    } catch (err) {
      job.error = err;
    } finally {
      job.done = true;
      running--;
      wake();
      pump();
    }
  };

  // Jobs start in sentence order, so the one the emitter waits on is
  // always among those running.
  const pump = () => {
    while (running < TTS_CONCURRENCY && nextJob < jobs.length && !failed && !inner.signal.aborted) {
      void synthesize(jobs[nextJob++]!);
    }
  };

  const startTts = (text: string) => {
    // A recap is in the language asked for, even when it quotes another.
    replyLang ??= rewind ? userLang : guessLanguage(text, userLang!);
    jobs.push({ text, chunks: [], done: false, error: null });
    wake();
    pump();
  };

  const llmTask = (async () => {
    const chunker = new SentenceChunker();
    let sentenceIndex = 0;
    const emitSentence = (text: string) => {
      if (timings.firstSentenceMs === null) timings.firstSentenceMs = since();
      events.push({ t: "sentence", i: sentenceIndex++, text });
      startTts(text);
    };
    try {
      const system = rewind
        ? rewindSystemPrompt({ lang: userLang, seconds: input.seconds ?? 15, now: input.now, timeZone: input.timeZone })
        : assistantSystemPrompt({ whisper: input.whisper, lang: userLang, now: input.now, timeZone: input.timeZone });
      const llmEvents =
        rewind && !transcript
          ? spoken(REWIND_EMPTY_LINE[userLang])
          : hedgeStream(
              (s) =>
                deps.llm.streamAssistantReply({
                  system,
                  history: rewind ? [] : input.history,
                  user: rewind ? rewindUserMessage(transcript) : transcript,
                  maxTokens: rewind ? 300 : input.whisper ? 200 : 700,
                  tools: rewind ? undefined : { searchNotes: deps.searchNotes },
                  signal: s,
                }),
              { afterMs: LLM_HEDGE_MS, signal: inner.signal, retryable, onHedge: (cause) => logHedge("llm", deps.llm.id, cause) },
            );
      for await (const ev of llmEvents) {
        if (failed) break;
        if (ev.type === "text") {
          if (timings.llmFirstTokenMs === null) timings.llmFirstTokenMs = since();
          reply += ev.delta;
          events.push({ t: "text", delta: ev.delta });
          for (const s of chunker.push(ev.delta)) emitSentence(s);
        } else if (ev.type === "tool_start") {
          events.push({ t: "tool", name: ev.name, state: "start" });
        } else if (ev.type === "tool_end") {
          events.push({ t: "tool", name: ev.name, state: "end" });
        } else if (ev.type === "refusal") {
          refusal = true;
        }
      }
      if (refusal) {
        const line = REFUSAL_LINE[userLang!];
        reply = line;
        events.push({ t: "text", delta: line });
        emitSentence(line);
      } else {
        const rest = chunker.flush();
        if (rest) emitSentence(rest);
      }
    } catch (err) {
      fail(err, "llm");
    } finally {
      llmDone = true;
      wake();
    }
  })();

  // Emits audio in sentence order as it arrives, then finishes the turn.
  const emitTask = (async () => {
    const carry = new Map<number, Uint8Array>();
    let i = 0;
    for (;;) {
      if (failed || inner.signal.aborted) break;
      const job = jobs[i];
      if (!job) {
        if (llmDone) break;
        await sleep();
        continue;
      }
      if (job.chunks.length) {
        for (const chunk of job.chunks.splice(0)) {
          const aligned = alignPcm(chunk, carry, i);
          if (!aligned.length) continue;
          if (timings.ttsFirstAudioMs === null) timings.ttsFirstAudioMs = since();
          events.push({ t: "audio", i, sr: deps.tts.sampleRate, pcm: Buffer.from(aligned).toString("base64") });
        }
        continue;
      }
      if (job.done) {
        if (job.error) {
          fail(job.error, "tts");
          break;
        }
        i++;
        continue;
      }
      await sleep();
    }
    await llmTask;
    signal.removeEventListener("abort", forwardAbort);
    if (!failed && !inner.signal.aborted) {
      timings.totalMs = since();
      outcome.reply = reply.trim();
      events.push({
        t: "done",
        reply: reply.trim(),
        language: replyLang ?? userLang!,
        refusal,
        server: timings,
        llmModel: deps.llm.model,
        ttsProvider: deps.tts.id,
      });
    }
    events.close();
  })();

  try {
    yield* events;
  } finally {
    await emitTask.catch(() => undefined);
  }
}

/** PCM16 must be split on 2 byte boundaries; odd bytes wait for the next chunk. */
function alignPcm(chunk: Uint8Array, carry: Map<number, Uint8Array>, key: number): Uint8Array {
  const prev = carry.get(key);
  let bytes = chunk;
  if (prev) {
    bytes = new Uint8Array(prev.length + chunk.length);
    bytes.set(prev);
    bytes.set(chunk, prev.length);
    carry.delete(key);
  }
  if (bytes.length % 2 === 1) {
    carry.set(key, bytes.subarray(bytes.length - 1));
    bytes = bytes.subarray(0, bytes.length - 1);
  }
  return bytes;
}

/** A fixed line, delivered the way the LLM delivers a reply. */
async function* spoken(line: string): AsyncGenerator<LlmEvent> {
  yield { type: "text", delta: line };
}

type Stage = "stt" | "llm" | "tts";

/** A hedge fired: which stage, which provider, and why. Codes only. */
function logHedge(stage: Stage, provider: string, cause: unknown) {
  if (cause === null) logMetric("assistant.hedge", { stage, provider, cause: "slow" });
  else logError("assistant.hedge", cause, { stage, provider });
}

/** Which stage and which provider failed, and how: codes only, never content. */
function logFailure(stage: Stage, err: unknown) {
  logError("assistant.failed", err, {
    stage,
    provider: err instanceof ProviderError ? err.provider : null,
    status: err instanceof ProviderError ? err.status : null,
  });
}

function codeOf(err: unknown): string {
  if (err instanceof ProviderError) return err.code === "rate_limited" ? "provider_rate_limited" : `provider_${err.code}`;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return "aborted";
  return "server_error";
}
