"use client";

import { getEngine } from "@/lib/audio/engine";
import { onOpenMicCount, type MicInput, type Processing } from "@/lib/audio/mic";
import { live } from "./live";
import { getPrefs } from "./prefs";

/**
 * The app's shared microphone. The assistant and the recorder use the same
 * open input (opening one per feature would stack processing and, on
 * Bluetooth, renegotiate the link). It reopens only when the device or the
 * processing profile changes.
 */
/** "opened": a new input is live (also after a device switch); "closed": on purpose; "lost": it vanished. */
export type MicChange = "opened" | "closed" | "lost";

class MicManager {
  private current: MicInput | null = null;
  private opening: Promise<MicInput> | null = null;
  private users = 0;
  private readonly changeListeners = new Set<(mic: MicInput | null, change: MicChange) => void>();

  /** Follows the shared input across reopenings, for features that keep listening. */
  onChange(l: (mic: MicInput | null, change: MicChange) => void): () => void {
    this.changeListeners.add(l);
    return () => this.changeListeners.delete(l);
  }

  private changed(mic: MicInput | null, change: MicChange) {
    for (const l of [...this.changeListeners]) l(mic, change);
  }

  private wanted(): { deviceId?: string; processing: Processing; gainDb: number } {
    const p = getPrefs();
    return {
      deviceId: p.inputDeviceId,
      processing: p.whisper ? "browser" : "voice",
      gainDb: p.whisper ? (p.whisperGainDb ?? 0) : 0,
    };
  }

  get mic(): MicInput | null {
    return this.current?.live ? this.current : null;
  }

  /** Opens (or reuses) the shared mic. Call from a user gesture on iOS. */
  async ensure(): Promise<MicInput> {
    const want = this.wanted();
    const cur = this.mic;
    if (cur && cur.processing === want.processing && (!want.deviceId || cur.deviceId === want.deviceId)) {
      cur.setGainDb(want.gainDb);
      return cur;
    }
    if (this.opening) return this.opening;
    this.opening = (async () => {
      this.current?.close();
      this.current = null;
      try {
        const mic = await getEngine().openMic(want);
        this.current = mic;
        mic.track.addEventListener("ended", () => {
          if (this.current === mic) {
            this.current = null;
            live.set({ micLost: true });
            this.changed(null, "lost");
          }
        });
        live.set({
          micLost: false,
          inputLabel: mic.label || null,
          contextRate: mic.ctx.sampleRate,
          trackRate: mic.settings.sampleRate ?? null,
        });
        this.changed(mic, "opened");
        return mic;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  /** Re-applies preferences (device, whisper profile) if a mic is open. */
  async refresh(): Promise<void> {
    if (this.current) await this.ensure();
  }

  /** Marks a feature as using the mic, so release() knows when to close it. */
  acquire(): () => void {
    this.users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users = Math.max(0, this.users - 1);
    };
  }

  close() {
    const had = this.current;
    this.current?.close();
    this.current = null;
    if (had) this.changed(null, "closed");
  }

  get inUse(): boolean {
    return this.users > 0;
  }
}

export const micManager = new MicManager();

if (typeof window !== "undefined") onOpenMicCount((n) => live.set({ micOpen: n > 0 }));
