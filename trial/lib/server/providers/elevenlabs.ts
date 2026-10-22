import "server-only";
import type { Lang } from "@/lib/shared/types";
import { providerFetch, readBody } from "./http";
import type { TtsOptions, TtsProvider } from "./types";

/**
 * ElevenLabs streaming TTS. eleven_flash_v2_5 is the low latency multilingual
 * model (Turkish included). Flash does not normalize numbers, so the
 * assistant prompt asks for numbers written the way they are spoken.
 * Voice ids must be configured: premade voices expire on 2026-12-31.
 */

const API = "https://api.elevenlabs.io/v1";

export class ElevenLabsTts implements TtsProvider {
  readonly id = "elevenlabs" as const;
  /** output_format=pcm_24000: 16 bit signed little endian mono, no header. */
  readonly sampleRate = 24000;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly voices: Record<Lang, string>,
  ) {}

  async *synthesize(text: string, opts: TtsOptions): AsyncIterable<Uint8Array> {
    const voice = encodeURIComponent(opts.voice ?? this.voices[opts.lang]);
    const res = await providerFetch("elevenlabs", `${API}/text-to-speech/${voice}/stream?output_format=pcm_24000`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: this.model,
        language_code: opts.lang,
        voice_settings: {
          stability: opts.whisper ? 0.7 : 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: !opts.whisper,
          speed: opts.whisper ? 0.95 : 1.0,
        },
      }),
      signal: opts.signal,
      // The reply waits on this: a response that has not started within a
      // few seconds is retried by the pipeline; a started stream may run long.
      headersTimeoutMs: 8_000,
      timeoutMs: 60_000,
    });
    yield* readBody(res, "elevenlabs", { signal: opts.signal, idleMs: 10_000 });
  }
}
