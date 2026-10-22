"use client";

import { floatToInt16 } from "@/lib/shared/audio/wav";
import type { BrowserStreamGrant } from "@/lib/server/providers/types";
import { api } from "./api";

/**
 * Live transcription straight from the browser to the recognizer, using a
 * short lived token from /api/stt/grant (the API key stays on the server).
 * Audio is buffered until the socket opens. finish() asks the recognizer to
 * finalize what it has and resolves with the transcript.
 *
 * Written against Deepgram's message format, which is the only provider
 * that issues browser credentials today. Any failure is reported, and the
 * caller falls back to uploading the recorded audio instead.
 */

interface ResultsMessage {
  type?: string;
  is_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
}

const KEEPALIVE_MS = 4000;

export class BrowserSttStream {
  private ws: WebSocket | null = null;
  private queue: ArrayBuffer[] = [];
  private finals: string[] = [];
  private interim = "";
  private failed = false;
  private open: Promise<void>;
  private finalized: (() => void) | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private lastSend = 0;
  onPartial: ((text: string) => void) | null = null;

  private constructor(private readonly grant: Promise<BrowserStreamGrant>) {
    this.open = this.connect();
    this.open.catch(() => {
      this.failed = true;
    });
  }

  static start(language: "en" | "tr"): BrowserSttStream {
    return new BrowserSttStream(api<BrowserStreamGrant>("/api/stt/grant", { method: "POST", json: { language } }));
  }

  private async connect(): Promise<void> {
    const grant = await this.grant;
    const ws = new WebSocket(grant.url, grant.protocols);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("stt socket error"));
    });
    ws.onmessage = (e) => this.onMessage(e);
    ws.onerror = () => {
      this.failed = true;
      this.finalized?.();
    };
    ws.onclose = () => this.finalized?.();
    for (const buf of this.queue.splice(0)) ws.send(buf);
    this.lastSend = performance.now();
    this.keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && performance.now() - this.lastSend > KEEPALIVE_MS) {
        ws.send(grant.messages.keepAlive);
        this.lastSend = performance.now();
      }
    }, 1000);
  }

  private onMessage(e: MessageEvent) {
    if (typeof e.data !== "string") return;
    let msg: ResultsMessage;
    try {
      msg = JSON.parse(e.data) as ResultsMessage;
    } catch {
      return;
    }
    if (msg.type !== "Results") return;
    const text = (msg.channel?.alternatives?.[0]?.transcript ?? "").trim();
    if (msg.is_final) {
      if (text) this.finals.push(text);
      this.interim = "";
    } else {
      this.interim = text;
    }
    this.onPartial?.([...this.finals, this.interim].filter(Boolean).join(" "));
    if (msg.from_finalize) this.finalized?.();
  }

  get ok(): boolean {
    return !this.failed;
  }

  send(samples16k: Float32Array) {
    if (this.failed) return;
    const pcm = floatToInt16(samples16k);
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buf);
      this.lastSend = performance.now();
    } else {
      this.queue.push(buf);
    }
  }

  /**
   * Finalizes and returns the transcript. Waits for the socket if it is
   * still opening. Resolves to null if the stream failed, so the caller can
   * fall back to the recorded audio.
   */
  async finish(timeoutMs = 1200): Promise<string | null> {
    const deadline = performance.now() + timeoutMs;
    const remaining = () => Math.max(0, deadline - performance.now());
    try {
      await Promise.race([this.open, new Promise((_, r) => setTimeout(() => r(new Error("open timeout")), remaining()))]);
    } catch {
      this.close();
      return null;
    }
    if (this.failed || !this.ws) return null;
    const grant = await this.grant;
    const done = new Promise<void>((r) => (this.finalized = r));
    this.ws.send(grant.messages.finalize);
    // Deepgram marks the result of a Finalize with from_finalize, but does
    // not promise to; a quiet period after the last message ends the wait.
    await Promise.race([done, new Promise((r) => setTimeout(r, Math.min(remaining(), 900)))]);
    const text = [...this.finals, this.interim].filter(Boolean).join(" ").trim();
    this.close();
    return this.failed && !text ? null : text;
  }

  close() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    const ws = this.ws;
    if (!ws) return;
    void this.grant.then((g) => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(g.messages.close);
        ws.close();
      } catch {
        // already closed
      }
    });
  }
}
