import "server-only";
import { decodeWav, rmsDbfs } from "@/lib/shared/audio/wav";
import { guessLanguage } from "@/lib/shared/lang-detect";
import { searchFold } from "@/lib/shared/notes";
import { EMBEDDING_DIMS, type Lang } from "@/lib/shared/types";
import type {
  AssistantReplyParams,
  AudioInput,
  EmbeddingProvider,
  ExtractParams,
  LlmEvent,
  LlmProvider,
  SttOptions,
  SttProvider,
  SttResult,
  SttStreamEvent,
  TtsOptions,
  TtsProvider,
} from "./types";

/**
 * Mock providers for development and automated tests. They need no keys and
 * never touch the network. Everything they produce says it is a mock, and the
 * UI shows a "mock providers" badge whenever one is active.
 */

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

/** FNV-1a, for deterministic pseudo randomness from bytes or text. */
function fnv1a(data: Uint8Array | string): number {
  let h = 0x811c9dc5;
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const MOCK_TRANSCRIPT: Record<Lang, string> = {
  en: "This is a mock transcript of what you said.",
  tr: "Bu, söylediklerinizin deneme dökümüdür.",
};

/* ----------------------------------------------------------------------------
   STT
   ------------------------------------------------------------------------- */

export class MockStt implements SttProvider {
  readonly id = "mock" as const;
  readonly model = "mock-stt";
  readonly capabilities = {
    streaming: false,
    browserStreaming: false,
    streamingLanguages: [],
    autoDetect: true,
  };

  /**
   * Silence (below -55 dBFS) transcribes to nothing, like a real provider.
   * With a hint (the lab passes its reference phrase, and only to this mock)
   * it returns the hint with a deterministic share of words dropped, keyed on
   * the audio bytes, so different processing chains score differently.
   */
  async transcribeFile(audio: AudioInput, opts: SttOptions): Promise<SttResult> {
    const started = performance.now();
    await sleep(120, opts.signal);
    let level = -Infinity;
    try {
      level = rmsDbfs(decodeWav(audio.data).samples);
    } catch {
      level = -Infinity;
    }
    const language: Lang = opts.language === "auto" ? (opts.hint ? guessLanguage(opts.hint) : "en") : opts.language;
    let text = "";
    if (level > -55) {
      if (opts.hint) {
        const seed = fnv1a(audio.data);
        const words = opts.hint.split(/\s+/);
        const dropEvery = 3 + (seed % 5);
        text = words.filter((_, i) => (i + seed) % dropEvery !== 0).join(" ");
      } else {
        text = MOCK_TRANSCRIPT[language];
      }
    }
    return {
      text,
      language,
      confidence: text ? 0.5 : null,
      provider: this.id,
      model: this.model,
      latencyMs: performance.now() - started,
    };
  }

  async *transcribeStream(audio: AsyncIterable<Int16Array>, opts: SttOptions): AsyncIterable<SttStreamEvent> {
    let samples = 0;
    for await (const chunk of audio) samples += chunk.length;
    const language: Lang = opts.language === "auto" ? "en" : opts.language;
    yield { type: "final", text: samples > 1600 ? MOCK_TRANSCRIPT[language] : "", language, confidence: 0.5 };
  }
}

/* ----------------------------------------------------------------------------
   LLM
   ------------------------------------------------------------------------- */

const NOTE_WORDS = /\b(note|notes|not|notlar|notlarım|notlarımda|kaydettiğim|recorded|remember|hatırla)/i;

export class MockLlm implements LlmProvider {
  readonly id = "mock" as const;
  readonly model = "mock-llm";

  async *streamAssistantReply(params: AssistantReplyParams): AsyncIterable<LlmEvent> {
    // A rewind recap: the user message is the transcript, the language is set by the prompt.
    const recap = params.user.startsWith("<transcript>");
    const said = recap ? params.user.replace(/<\/?transcript>/g, "") : params.user;
    const lang = recap ? (params.system.includes("Speak Turkish") ? "tr" : "en") : guessLanguage(params.user);
    const heard = said.trim().replace(/[.!?…]+$/u, "");
    let found = "";
    if (params.tools && NOTE_WORDS.test(params.user)) {
      yield { type: "tool_start", name: "search_notes" };
      const result = await params.tools.searchNotes(params.user);
      yield { type: "tool_end", name: "search_notes", ok: true };
      const count = result === "No matching notes." ? 0 : (result.match(/^\[\d+\]/gm)?.length ?? 0);
      found =
        lang === "tr"
          ? ` Notlarınızda ${count} eşleşme buldum.`
          : ` I found ${count} matching notes.`;
    }
    const reply = recap
      ? lang === "tr"
        ? `Bu bir deneme özeti. Etrafınızda şu söylendi: ${heard}. Gerçek bir dil modeline bağlı değilim.`
        : `This is a mock recap. Someone around you said: ${heard}. No language model was called.`
      : lang === "tr"
        ? `Bu bir deneme yanıtı. Şunu duydum: ${heard}.${found} Gerçek bir dil modeline bağlı değilim.`
        : `This is a mock reply. I heard: ${heard}.${found} No language model was called.`;

    await sleep(150, params.signal);
    for (const word of reply.split(/(?<=\s)/)) {
      yield { type: "text", delta: word };
      await sleep(12, params.signal);
    }
    yield { type: "done", stopReason: "end_turn", inputTokens: null, outputTokens: null };
  }

  async extractStructured<T>(params: ExtractParams<T>): Promise<T | null> {
    await sleep(80, params.signal);
    const text = params.user.replace(/^[\s\S]*?<transcript>/, "").replace(/<\/transcript>[\s\S]*$/, "");
    const lines = text.split("\n").map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim()).filter(Boolean);
    const all = lines.join(" ");
    const lang = guessLanguage(all);
    const sentences = all.split(/(?<=[.!?])\s+/).filter(Boolean);
    const words = all.split(/\s+/).filter(Boolean);
    const candidate = {
      title: words.slice(0, 6).join(" ") || (lang === "tr" ? "Boş kayıt" : "Empty recording"),
      summary: sentences.slice(0, 2).join(" ") || (lang === "tr" ? "Konuşma yok." : "No speech."),
      action_items: sentences.filter((s) => /(need to|should|must|remind|lazım|gerek|hatırlat)/i.test(s)).slice(0, 5),
      topics: [...new Set(words.filter((w) => w.length > 6).map((w) => w.replace(/[^\p{L}]/gu, "")))].slice(0, 3),
      people_mentioned: [
        ...new Set(
          words
            .slice(1)
            .filter((w) => /^\p{Lu}\p{Ll}+$/u.test(w.replace(/[^\p{L}]/gu, "")))
            .map((w) => w.replace(/[^\p{L}]/gu, "")),
        ),
      ].slice(0, 5),
      language: lang,
    };
    const parsed = params.schema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
}

/* ----------------------------------------------------------------------------
   TTS: a short tone per word, so playback, chunking and barge-in can be tested.
   ------------------------------------------------------------------------- */

export class MockTts implements TtsProvider {
  readonly id = "mock" as const;
  readonly model = "mock-tts";
  readonly sampleRate = 24000;

  async *synthesize(text: string, opts: TtsOptions): AsyncIterable<Uint8Array> {
    await sleep(60, opts.signal);
    const amplitude = opts.whisper ? 0.06 : 0.18;
    const toneSamples = Math.round(this.sampleRate * 0.11);
    const gapSamples = Math.round(this.sampleRate * 0.05);
    for (const word of text.split(/\s+/).filter(Boolean)) {
      // Each voice gets its own register, so several mock voices stay apart.
      const freq = 260 + (opts.voice ? (fnv1a(opts.voice) % 4) * 90 : 0) + (fnv1a(word) % 220);
      const pcm = new Int16Array(toneSamples + gapSamples);
      for (let i = 0; i < toneSamples; i++) {
        // Raised cosine envelope, so tones do not click.
        const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / toneSamples);
        pcm[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / this.sampleRate) * env * amplitude * 0x7fff);
      }
      yield new Uint8Array(pcm.buffer);
      await sleep(15, opts.signal);
    }
  }
}

/* ----------------------------------------------------------------------------
   Embeddings: feature hashing of words and character trigrams. Crude, but
   deterministic, offline, and good enough to show that semantic search runs.
   ------------------------------------------------------------------------- */

export class MockEmbeddings implements EmbeddingProvider {
  readonly id = "mock" as const;
  readonly model = "mock-hash-1024";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashEmbedding(t));
  }
}

export function hashEmbedding(text: string): number[] {
  const v = new Float64Array(EMBEDDING_DIMS);
  const words = searchFold(text).split(" ").filter(Boolean);
  const add = (feature: string, weight: number) => {
    const h = fnv1a(feature);
    v[h % EMBEDDING_DIMS]! += (h & 0x80000000 ? -1 : 1) * weight;
  };
  for (const w of words) {
    add(`w:${w}`, 1);
    const padded = `^${w}$`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`c:${padded.slice(i, i + 3)}`, 0.35);
  }
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}
