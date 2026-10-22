"use client";

import { useEffect } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { onEngineCreated, peekEngine } from "@/lib/audio/engine";
import { live } from "@/lib/client/live";
import { useStore } from "@/lib/client/store";

/**
 * iOS suspends (or "interrupts") the AudioContext when the page is hidden,
 * during a call, or for Siri, and only a tap may resume it. While a mic is
 * open and the context is not running, this offers that tap.
 */
export function AudioResume() {
  const { m } = useI18n();
  const s = useStore(live);

  useEffect(() => {
    const check = () => {
      const e = peekEngine();
      const suspended = !!e && e.ctx.state !== "running" && live.get().micOpen;
      live.set({ audioSuspended: suspended });
    };
    const off = onEngineCreated((e) => {
      e.ctx.addEventListener("statechange", check);
    });
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Allowed without a gesture on most platforms; iOS may refuse.
      void peekEngine()?.ctx.resume().catch(() => undefined).finally(check);
    };
    document.addEventListener("visibilitychange", onVisible);
    const unsub = live.subscribe(check);
    return () => {
      off();
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!s.audioSuspended) return null;
  return (
    <button
      type="button"
      onClick={() => void peekEngine()?.resume().finally(() => live.set({ audioSuspended: false }))}
      className="sticky top-[calc(var(--strip-h)+env(safe-area-inset-top))] z-30 block w-full border-b border-[var(--hairline-strong)] bg-paper px-4 py-3 text-center text-[0.92rem] font-medium text-ink"
    >
      {m.status.audioSuspended}
    </button>
  );
}
