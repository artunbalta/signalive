import "server-only";
import { EMBEDDING_DIMS, type Lang } from "@/lib/shared/types";
import { providerFetch, readBody, toLang } from "./http";
import type {
  AudioInput,
  EmbeddingProvider,
  SttOptions,
  SttProvider,
  SttResult,
  SttStreamEvent,
  TtsOptions,
  TtsProvider,
} from "./types";

/**
 * OpenAI speech to text, text to speech and embeddings over plain fetch.
 *
 * Deprecations to plan for: the /v1/audio/speech models (gpt-4o-mini-tts,
 * tts-1) shut down on 2027-01-06, and whisper-1 and the gpt-4o transcribe
 * models on 2027-02-26. gpt-transcribe is the current transcription model.
 */

const API = "https://api.openai.com/v1";

/** Shared by the batch adapters that only have a file endpoint. */
export async function* bufferThenTranscribe(
  provider: SttProvider,
  audio: AsyncIterable<Int16Array>,
  opts: SttOptions,
): AsyncIterable<SttStreamEvent> {
  const { encodeWav } = await import("@/lib/shared/audio/wav");
  const chunks: Int16Array[] = [];
  let total = 0;
  for await (const c of audio) {
    chunks.push(c);
    total += c.length;
  }
  const pcm = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    pcm.set(c, offset);
    offset += c.length;
  }
  const result = await provider.transcribeFile(
    { data: encodeWav(pcm, 16000), mimeType: "audio/wav", durationMs: (total / 16000) * 1000 },
    opts,
  );
  yield { type: "final", text: result.text, language: result.language, confidence: result.confidence };
}

export class OpenAiStt implements SttProvider {
  readonly id = "openai" as const;
  readonly capabilities = {
    streaming: false,
    browserStreaming: false,
    streamingLanguages: [],
    autoDetect: true,
  };

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async transcribeFile(audio: AudioInput, opts: SttOptions): Promise<SttResult> {
    const form = new FormData();
    form.append("file", new Blob([audio.data as BlobPart], { type: audio.mimeType || "audio/wav" }), "audio.wav");
    form.append("model", this.model);
    form.append("response_format", "json");
    if (opts.language !== "auto") {
      // gpt-transcribe takes a list of expected languages instead of one.
      if (this.model.startsWith("gpt-transcribe")) form.append("languages[]", opts.language);
      else form.append("language", opts.language);
    }
    const started = performance.now();
    const res = await providerFetch("openai", `${API}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: opts.signal,
      timeoutMs: 30_000,
    });
    const json = (await res.json()) as { text?: string; languages?: { code?: string }[]; language?: string };
    return {
      text: (json.text ?? "").trim(),
      language:
        toLang(json.languages?.[0]?.code) ?? toLang(json.language) ?? (opts.language === "auto" ? null : opts.language),
      confidence: null,
      provider: this.id,
      model: this.model,
      latencyMs: performance.now() - started,
    };
  }

  transcribeStream(audio: AsyncIterable<Int16Array>, opts: SttOptions): AsyncIterable<SttStreamEvent> {
    return bufferThenTranscribe(this, audio, opts);
  }
}

const VOICE_STYLE: Record<"normal" | "whisper", string> = {
  normal: "Speak naturally and clearly, at a relaxed, friendly pace.",
  whisper: "Speak softly and quietly, close to the listener, calm and low in energy, as if in a quiet public place.",
};

export class OpenAiTts implements TtsProvider {
  readonly id = "openai" as const;
  /** response_format "pcm": 24 kHz, 16 bit signed little endian, no header. */
  readonly sampleRate = 24000;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly voices: Record<Lang, string>,
  ) {}

  async *synthesize(text: string, opts: TtsOptions): AsyncIterable<Uint8Array> {
    const supportsInstructions = !this.model.startsWith("tts-1");
    const res = await providerFetch("openai", `${API}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        voice: opts.voice ?? this.voices[opts.lang],
        input: text,
        response_format: "pcm",
        ...(supportsInstructions ? { instructions: opts.style ?? VOICE_STYLE[opts.whisper ? "whisper" : "normal"] } : {}),
      }),
      signal: opts.signal,
      // The reply waits on this: a response that has not started within a
      // few seconds is retried by the pipeline; a started stream may run long.
      headersTimeoutMs: 8_000,
      timeoutMs: 60_000,
    });
    yield* readBody(res, "openai", { signal: opts.signal, idleMs: 10_000 });
  }
}

export class OpenAiEmbeddings implements EmbeddingProvider {
  readonly id = "openai" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async embed(texts: string[], _kind: "query" | "document", signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await providerFetch("openai", `${API}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        input: texts.map((t) => t || " "),
        dimensions: EMBEDDING_DIMS,
        encoding_format: "float",
      }),
      signal,
      timeoutMs: 15_000,
    });
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const out: number[][] = new Array(texts.length);
    for (const d of json.data ?? []) out[d.index] = d.embedding;
    return out;
  }
}
