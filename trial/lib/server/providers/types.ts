import type { z } from "zod";
import type {
  EmbeddingProviderId,
  Lang,
  LlmProviderId,
  SpeechLang,
  SttProviderId,
  TtsProviderId,
} from "@/lib/shared/types";

/**
 * Adapter interfaces. Route handlers only ever talk to these; which concrete
 * provider sits behind each one is decided in ./index.ts from the environment.
 */

/* ----------------------------------------------------------------------------
   Speech to text
   ------------------------------------------------------------------------- */

export interface AudioInput {
  /** A complete audio file. The app always sends 16 bit PCM WAV. */
  data: Uint8Array;
  mimeType: string;
  durationMs: number;
}

export interface SttOptions {
  language: SpeechLang;
  signal?: AbortSignal;
  /**
   * Read by the mock provider only. Real adapters must never forward it: the
   * lab passes the reference phrase here, and biasing a real recognizer with
   * the answer would invalidate the error rates.
   */
  hint?: string;
}

export interface SttResult {
  text: string;
  /** Detected or requested language; null when the provider cannot say. */
  language: Lang | null;
  confidence: number | null;
  provider: SttProviderId;
  model: string;
  /** Wall time of the provider call, measured on our side. */
  latencyMs: number;
}

export type SttStreamEvent =
  | { type: "partial"; text: string }
  | { type: "final"; text: string; language: Lang | null; confidence: number | null }
  | { type: "error"; code: string };

/**
 * Everything a browser needs to stream audio straight to the provider without
 * ever seeing our API key: a WebSocket URL and a short lived credential.
 */
export interface BrowserStreamGrant {
  provider: SttProviderId;
  url: string;
  /** Sec-WebSocket-Protocol values that carry the temporary credential. */
  protocols: string[];
  expiresAt: string;
  sampleRate: number;
  /** JSON messages the client sends for these control actions. */
  messages: { finalize: string; keepAlive: string; close: string };
}

export interface SttCapabilities {
  /** transcribeStream yields partials as audio arrives (not just a final). */
  streaming: boolean;
  /** createBrowserStreamGrant is implemented. */
  browserStreaming: boolean;
  /** Languages the streaming path can recognize, "auto" included if it detects. */
  streamingLanguages: SpeechLang[];
  /** The provider detects the language on its own. */
  autoDetect: boolean;
}

export interface SttProvider {
  readonly id: SttProviderId;
  readonly model: string;
  readonly capabilities: SttCapabilities;
  transcribeFile(audio: AudioInput, opts: SttOptions): Promise<SttResult>;
  /**
   * Server side streaming: 16 kHz mono PCM16 chunks in, transcript events
   * out. This is the entry point a WebSocket relay would call. Providers
   * without a streaming API buffer the audio and emit one final event.
   */
  transcribeStream(audio: AsyncIterable<Int16Array>, opts: SttOptions): AsyncIterable<SttStreamEvent>;
  createBrowserStreamGrant?(opts: { language: SpeechLang }): Promise<BrowserStreamGrant>;
}

/* ----------------------------------------------------------------------------
   LLM
   ------------------------------------------------------------------------- */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantTools {
  /** Returns a plain text block describing the matching notes. */
  searchNotes(query: string): Promise<string>;
}

export interface AssistantReplyParams {
  system: string;
  history: ChatTurn[];
  user: string;
  maxTokens: number;
  tools?: AssistantTools;
  signal?: AbortSignal;
}

export type LlmEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; ok: boolean }
  | { type: "done"; stopReason: string; inputTokens: number | null; outputTokens: number | null }
  | { type: "refusal" };

export interface ExtractParams<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly model: string;
  streamAssistantReply(params: AssistantReplyParams): AsyncIterable<LlmEvent>;
  /**
   * One structured call. Returns null when the output does not validate
   * against the schema; the caller decides whether to retry.
   */
  extractStructured<T>(params: ExtractParams<T>): Promise<T | null>;
}

/* ----------------------------------------------------------------------------
   Text to speech
   ------------------------------------------------------------------------- */

export interface TtsOptions {
  lang: Lang;
  /** Quiet, close, low energy delivery for whisper mode. */
  whisper: boolean;
  /** A voice of this provider to use instead of the one configured for lang. */
  voice?: string;
  /** How to speak, for models that take instructions; replaces the default style. */
  style?: string;
  signal?: AbortSignal;
}

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly model: string;
  /** Sample rate of the PCM this provider yields. */
  readonly sampleRate: number;
  /** Raw PCM: 16 bit signed little endian, mono, at sampleRate. */
  synthesize(text: string, opts: TtsOptions): AsyncIterable<Uint8Array>;
}

/* ----------------------------------------------------------------------------
   Embeddings
   ------------------------------------------------------------------------- */

export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  /** Stored next to every vector; vectors from different models never mix. */
  readonly model: string;
  embed(texts: string[], kind: "query" | "document", signal?: AbortSignal): Promise<number[][]>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
    readonly status: number | null = null,
  ) {
    super(`${provider}: ${code}${status ? ` (${status})` : ""}`);
    this.name = "ProviderError";
  }
}
