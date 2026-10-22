"use client";

import { resample } from "@/lib/audio/resample";
import { encodeWav, pcm16BytesToInt16 } from "@/lib/shared/audio/wav";
import type { Lang, SpeechLang } from "@/lib/shared/types";
import { apiFetch } from "./api";
import { base64ToBytes, readNdjson } from "./ndjson";
import { getPrefs } from "./prefs";

/** The shortest clip the server takes. */
export const MIN_RECAP_SEC = 1;

export interface RecapHandlers {
  transcript(text: string): void;
  text(delta: string): void;
  audio(pcm: Int16Array, sampleRate: number): void;
  error(code: string): void;
}

/**
 * Sends some seconds of audio to /api/rewind, once, and streams back what was
 * said in them: the transcript, the recap text, and its speech. The recap is
 * in the app's language. A failed request throws ApiError; a failure inside
 * the stream goes to handlers.error.
 */
export async function requestRecap(
  clip: Float32Array,
  rate: number,
  signal: AbortSignal,
  on: RecapHandlers,
  opts: { speechLang?: SpeechLang } = {},
): Promise<void> {
  const prefs = getPrefs();
  const replyLang: Lang = document.documentElement.lang === "tr" ? "tr" : "en";
  const meta = {
    speechLang: opts.speechLang ?? prefs.speechLang ?? "auto",
    replyLang,
    whisper: !!prefs.whisper,
    seconds: Math.max(MIN_RECAP_SEC, Math.round((clip.length / rate) * 10) / 10),
    now: new Date().toLocaleString(replyLang === "tr" ? "tr-TR" : "en-GB", { dateStyle: "full", timeStyle: "short" }),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
  };
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append("audio", new Blob([encodeWav(resample(clip, rate, 16000), 16000) as BlobPart], { type: "audio/wav" }), "recap.wav");
  const res = await apiFetch("/api/rewind", { method: "POST", body: form, signal });
  await readNdjson(res, (ev) => {
    if (signal.aborted) return;
    switch (ev.t) {
      case "transcript":
        on.transcript(String(ev.text ?? ""));
        break;
      case "text":
        on.text(String(ev.delta ?? ""));
        break;
      case "audio":
        on.audio(pcm16BytesToInt16(base64ToBytes(String(ev.pcm ?? ""))), Number(ev.sr) || 24000);
        break;
      case "error":
        on.error(String(ev.code ?? "generic"));
        break;
    }
  });
}
