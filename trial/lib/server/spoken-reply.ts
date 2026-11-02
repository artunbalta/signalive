import "server-only";
import { guessLanguage } from "@/lib/shared/lang-detect";
import { SentenceChunker } from "@/lib/shared/sentences";
import type { Lang } from "@/lib/shared/types";
import { hedgeStream, retryableProviderError as retryable } from "@/lib/server/hedge";
import { logError, logMetric } from "@/lib/server/log";
import { REFUSAL_LINE } from "@/lib/server/prompts";
import { AsyncQueue } from "@/lib/server/providers/http";
import { ProviderError, type LlmEvent, type TtsProvider } from "@/lib/server/providers/types";

/**
 * A reply as every voice route streams it: text as the LLM writes it (or a
 * fixed line), cut into sentences, and TTS for a sentence started as soon as
 * the sentence is complete and a slot is free, so the next sentence
 * synthesizes while the current one plays; audio events still come out
 * strictly in order. The assistant, rewind, moments, the agent and plain
 * speech all reply through this.
 */

export type ReplyEvent =
  | { t: "tool"; name: string; state: "start" | "end" }
  | { t: "text"; delta: string }
  | { t: "sentence"; i: number; text: string }
  | { t: "audio"; i: number; sr: number; pcm: string }
  | { t: "error"; code: string };

export interface ReplyTimings {
  llmFirstTokenMs: number | null;
  firstSentenceMs: number | null;
  ttsFirstAudioMs: number | null;
}

export interface ReplyResult {
  /** False when the reply failed (its error was the last event) or was aborted. */
  ok: boolean;
  reply: string;
  language: Lang;
  refusal: boolean;
  /** The model the LLM reported in its done event (a fallback model after a refusal), if it did. */
  model: string | null;
  timings: ReplyTimings;
  /** since() once the last audio had been handed over. */
  endMs: number;
}

export interface ReplyOptions {
  /** Speaks the reply; null streams the text alone, with no sentences or audio. */
  tts: TtsProvider | null;
  /** The language to speak; null takes it from the first sentence. */
  lang: Lang | null;
  /** The language the user spoke: what that guess falls back to, and the language of the refusal line. */
  userLang: Lang;
  whisper: boolean;
  /** Text events as well as sentences (default); false for a fixed line the client already knows. */
  textEvents?: boolean;
  signal: AbortSignal;
  /** Milliseconds since the turn started, for the timings. */
  since: () => number;
  /** Names the log lines: "<metric>.failed", "<metric>.hedge". */
  metric: string;
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
export const LLM_HEDGE_MS = 5000;
export const sttHedgeMs = (audioMs: number) => 2500 + 0.15 * audioMs;

export class SpokenReply<X = never> {
  private readonly events = new AsyncQueue<ReplyEvent | X>();

  constructor(private readonly opts: ReplyOptions) {}

  /** Adds an event of the caller's own (an action the agent proposed) to the stream at this point. */
  push(event: X) {
    this.events.push(event);
  }

  /**
   * Streams the reply that source produces, given the signal its requests
   * must follow, and returns how it went. The first failure ends the reply:
   * it is the last event, and the LLM and TTS calls are aborted.
   */
  async *run(source: (signal: AbortSignal) => AsyncIterable<LlmEvent>): AsyncGenerator<ReplyEvent | X, ReplyResult> {
    const { tts, signal, since, metric } = this.opts;
    const textEvents = this.opts.textEvents ?? true;
    const events = this.events;
    const timings: ReplyTimings = { llmFirstTokenMs: null, firstSentenceMs: null, ttsFirstAudioMs: null };
    const inner = new AbortController();
    const forwardAbort = () => inner.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    if (signal.aborted) inner.abort();
    const jobs: TtsJob[] = [];
    let nextJob = 0;
    let running = 0;
    let llmDone = false;
    let replyLang: Lang | null = null;
    let reply = "";
    let refusal = false;
    let model: string | null = null;
    let failed = false;
    let ok = false;
    let endMs = 0;

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
        logFailure(metric, stage, err);
        events.push({ t: "error", code: codeOf(err) });
      }
      events.close();
      inner.abort();
      wake();
    };

    const synthesize = async (job: TtsJob, voice: TtsProvider) => {
      running++;
      try {
        // Hedged until the first audio arrives; after that a failure ends the
        // reply, since a second attempt would repeat what was already heard.
        const audio = hedgeStream((s) => voice.synthesize(job.text, { lang: replyLang!, whisper: this.opts.whisper, signal: s }), {
          afterMs: TTS_HEDGE_MS,
          signal: inner.signal,
          retryable,
          onHedge: (cause) => logHedge(metric, "tts", voice.id, cause),
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
      while (tts && running < TTS_CONCURRENCY && nextJob < jobs.length && !failed && !inner.signal.aborted) {
        void synthesize(jobs[nextJob++]!, tts);
      }
    };

    const startTts = (text: string) => {
      replyLang ??= this.opts.lang ?? guessLanguage(text, this.opts.userLang);
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
        for await (const ev of source(inner.signal)) {
          if (failed) break;
          if (ev.type === "text") {
            if (timings.llmFirstTokenMs === null) timings.llmFirstTokenMs = since();
            reply += ev.delta;
            if (textEvents) events.push({ t: "text", delta: ev.delta });
            if (tts) for (const s of chunker.push(ev.delta)) emitSentence(s);
          } else if (ev.type === "tool_start") {
            events.push({ t: "tool", name: ev.name, state: "start" });
          } else if (ev.type === "tool_end") {
            events.push({ t: "tool", name: ev.name, state: "end" });
          } else if (ev.type === "refusal") {
            refusal = true;
          } else if (ev.type === "done" && ev.model) {
            model = ev.model;
          }
        }
        if (refusal) {
          const line = REFUSAL_LINE[this.opts.lang ?? this.opts.userLang];
          reply = line;
          if (textEvents) events.push({ t: "text", delta: line });
          if (tts) emitSentence(line);
        } else if (tts) {
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

    // Emits audio in sentence order as it arrives, then ends the reply.
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
            events.push({ t: "audio", i, sr: tts!.sampleRate, pcm: Buffer.from(aligned).toString("base64") });
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
      ok = !failed && !inner.signal.aborted;
      endMs = since();
      events.close();
    })();

    try {
      yield* events;
    } finally {
      await emitTask.catch(() => undefined);
    }
    return { ok, reply: reply.trim(), language: replyLang ?? this.opts.lang ?? this.opts.userLang, refusal, model, timings, endMs };
  }
}

/** A fixed line, delivered the way the LLM delivers a reply. */
export async function* spoken(line: string): AsyncGenerator<LlmEvent> {
  yield { type: "text", delta: line };
}

/**
 * A text the client already has (a moment's confirmation, a summary read
 * aloud), spoken in lang: sentence and audio events only.
 */
export function speakLine(
  line: string,
  opts: { tts: TtsProvider; lang: Lang; signal: AbortSignal; since: () => number; metric: string },
): AsyncGenerator<ReplyEvent, ReplyResult> {
  return new SpokenReply({ ...opts, userLang: opts.lang, whisper: false, textEvents: false }).run(() => spoken(line));
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

export type Stage = "stt" | "llm" | "tts";

/** A hedge fired: which stage, which provider, and why. Codes only. */
export function logHedge(metric: string, stage: Stage, provider: string, cause: unknown) {
  if (cause === null) logMetric(`${metric}.hedge`, { stage, provider, cause: "slow" });
  else logError(`${metric}.hedge`, cause, { stage, provider });
}

/** Which stage and which provider failed, and how: codes only, never content. */
export function logFailure(metric: string, stage: Stage, err: unknown) {
  logError(`${metric}.failed`, err, {
    stage,
    provider: err instanceof ProviderError ? err.provider : null,
    status: err instanceof ProviderError ? err.status : null,
  });
}

export function codeOf(err: unknown): string {
  if (err instanceof ProviderError) return err.code === "rate_limited" ? "provider_rate_limited" : `provider_${err.code}`;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return "aborted";
  return "server_error";
}
