import "server-only";
import { AsyncQueue, providerFetch, toLang } from "./http";
import {
  ProviderError,
  type AudioInput,
  type BrowserStreamGrant,
  type SttOptions,
  type SttProvider,
  type SttResult,
  type SttStreamEvent,
} from "./types";
import type { Lang, SpeechLang } from "@/lib/shared/types";

/**
 * Deepgram, pre-recorded and live.
 *
 * Turkish needs language=tr: nova-3's "multi" mode does not include Turkish,
 * and live streaming has no language detection. So "auto" is only supported
 * for files, where detect_language is restricted to English and Turkish.
 *
 * Browser streaming uses a temporary token from /v1/auth/grant (30 seconds,
 * enough to open the socket; an open socket outlives the token). The key
 * needs the Member role or higher to grant tokens.
 */

const API = "https://api.deepgram.com/v1";
const WSS = "wss://api.deepgram.com/v1/listen";
export const STREAM_SAMPLE_RATE = 16000;

interface DeepgramAlternative {
  transcript?: string;
  confidence?: number;
}
interface DeepgramFileResponse {
  results?: {
    channels?: { alternatives?: DeepgramAlternative[]; detected_language?: string }[];
  };
}
interface DeepgramLiveMessage {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: DeepgramAlternative[] };
}

export class DeepgramStt implements SttProvider {
  readonly id = "deepgram" as const;
  readonly capabilities = {
    streaming: true,
    browserStreaming: true,
    streamingLanguages: ["en", "tr"] as SpeechLang[],
    autoDetect: true,
  };

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  private liveParams(language: Lang): URLSearchParams {
    return new URLSearchParams({
      model: this.model,
      language,
      encoding: "linear16",
      sample_rate: String(STREAM_SAMPLE_RATE),
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      // We decide where an utterance ends (button release or our VAD) and
      // send Finalize; Deepgram's endpointing only splits the finals.
      endpointing: "300",
    });
  }

  async transcribeFile(audio: AudioInput, opts: SttOptions): Promise<SttResult> {
    const params = new URLSearchParams({ model: this.model, smart_format: "true", punctuate: "true" });
    if (opts.language === "auto") {
      params.append("detect_language", "en");
      params.append("detect_language", "tr");
    } else {
      params.set("language", opts.language);
    }
    const started = performance.now();
    const res = await providerFetch("deepgram", `${API}/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": audio.mimeType || "audio/wav" },
      body: audio.data as BodyInit,
      signal: opts.signal,
      timeoutMs: 30_000,
    });
    const json = (await res.json()) as DeepgramFileResponse;
    const channel = json.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];
    return {
      text: (alt?.transcript ?? "").trim(),
      language: toLang(channel?.detected_language) ?? (opts.language === "auto" ? null : opts.language),
      confidence: typeof alt?.confidence === "number" ? alt.confidence : null,
      provider: this.id,
      model: this.model,
      latencyMs: performance.now() - started,
    };
  }

  async createBrowserStreamGrant({ language }: { language: SpeechLang }): Promise<BrowserStreamGrant> {
    if (language === "auto") throw new ProviderError("deepgram", "streaming_needs_language");
    const res = await providerFetch("deepgram", `${API}/auth/grant`, {
      method: "POST",
      headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 30 }),
      timeoutMs: 5_000,
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new ProviderError("deepgram", "grant_failed");
    return {
      provider: this.id,
      url: `${WSS}?${this.liveParams(language)}`,
      protocols: ["bearer", json.access_token],
      expiresAt: new Date(Date.now() + (json.expires_in ?? 30) * 1000).toISOString(),
      sampleRate: STREAM_SAMPLE_RATE,
      messages: {
        finalize: JSON.stringify({ type: "Finalize" }),
        keepAlive: JSON.stringify({ type: "KeepAlive" }),
        close: JSON.stringify({ type: "CloseStream" }),
      },
    };
  }

  /**
   * Server side live transcription (the entry point for a relay). Sends the
   * PCM as it arrives, then Finalize and CloseStream, and yields the
   * concatenated is_final transcripts as one final event.
   */
  async *transcribeStream(audio: AsyncIterable<Int16Array>, opts: SttOptions): AsyncIterable<SttStreamEvent> {
    const language: Lang = opts.language === "auto" ? "en" : opts.language;
    const events = new AsyncQueue<SttStreamEvent>();
    const finals: string[] = [];
    let confidence: number | null = null;

    const ws = new WebSocket(`${WSS}?${this.liveParams(language)}`, ["token", this.apiKey]);
    ws.binaryType = "arraybuffer";
    const opened = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new ProviderError("deepgram", "socket")), { once: true });
    });
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string") return;
      let msg: DeepgramLiveMessage;
      try {
        msg = JSON.parse(e.data) as DeepgramLiveMessage;
      } catch {
        return;
      }
      if (msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      const text = (alt?.transcript ?? "").trim();
      if (msg.is_final) {
        if (text) finals.push(text);
        if (typeof alt?.confidence === "number") confidence = alt.confidence;
      } else if (text) {
        events.push({ type: "partial", text: [...finals, text].join(" ") });
      }
    });
    ws.addEventListener("close", () => {
      events.push({ type: "final", text: finals.join(" "), language, confidence });
      events.close();
    });
    opts.signal?.addEventListener("abort", () => ws.close(), { once: true });

    const pump = (async () => {
      await opened;
      for await (const chunk of audio) {
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "Finalize" }));
        ws.send(JSON.stringify({ type: "CloseStream" }));
      }
    })().catch(() => {
      events.push({ type: "error", code: "socket" });
      events.close();
      try {
        ws.close();
      } catch {
        // already closed
      }
    });

    try {
      yield* events;
    } finally {
      // The pump may be parked on the next audio chunk; closing the socket is
      // enough for it to stop at that point.
      void pump;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
  }
}
