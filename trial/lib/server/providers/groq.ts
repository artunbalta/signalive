import "server-only";
import { providerFetch, toLang } from "./http";
import { bufferThenTranscribe } from "./openai";
import type { AudioInput, SttOptions, SttProvider, SttResult, SttStreamEvent } from "./types";

/**
 * Groq's hosted Whisper (OpenAI compatible endpoint). The third recognizer
 * in the lab because it is a different model family from the other two and
 * its weights are public, which makes results easier to reproduce elsewhere.
 * Groq downsamples to 16 kHz mono and bills at least 10 seconds per request.
 */

const API = "https://api.groq.com/openai/v1";

export class GroqStt implements SttProvider {
  readonly id = "groq" as const;
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
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (opts.language !== "auto") form.append("language", opts.language);
    const started = performance.now();
    const res = await providerFetch("groq", `${API}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: opts.signal,
      timeoutMs: 30_000,
    });
    // verbose_json may carry "language" as a code or a name; it is optional.
    const json = (await res.json()) as { text?: string; language?: string };
    return {
      text: (json.text ?? "").trim(),
      language: toLang(json.language) ?? (opts.language === "auto" ? null : opts.language),
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
