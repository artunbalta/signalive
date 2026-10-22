"use client";

import { useI18n } from "@/components/providers/AppProviders";
import { live } from "@/lib/client/live";
import { recorderControls } from "@/lib/client/recorder-controls";
import { rewind } from "@/lib/client/rewind";
import { useStore } from "@/lib/client/store";

/**
 * Shown on every screen whenever the recorder is on or paused, or Rewind is
 * keeping the last seconds. Capture is never silent: the coral dot, the
 * sentence, and a one tap way to stop are always in view, whatever page the
 * visitor is on.
 */
export function RecordingBanner() {
  const { m } = useI18n();
  const s = useStore(live);
  if (s.recording === "off" && !s.rewindOn) return null;
  const on = s.recording === "on";
  return (
    <div
      role="status"
      className="sticky top-[calc(var(--strip-h)+env(safe-area-inset-top))] z-30 border-b border-[var(--hairline)] bg-well-2/95 backdrop-blur-md"
    >
      {s.rewindOn ? (
        <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-2.5 sm:px-6">
          <span className="rec-dot" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[0.88rem] leading-snug">{m.rewind.banner}</p>
          <button
            type="button"
            onClick={() => rewind.disable()}
            className="min-h-11 shrink-0 rounded-full border border-[var(--hairline-strong)] px-4 text-[0.88rem] font-medium hover:border-paper/60"
          >
            {m.rewind.turnOff}
          </button>
        </div>
      ) : null}
      {s.recording === "off" ? null : (
      <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-2.5 sm:px-6">
        {on ? <span className="rec-dot" aria-hidden="true" /> : <span className="h-2.5 w-2.5 rounded-full border border-mist" aria-hidden="true" />}
        <p className="min-w-0 flex-1 text-[0.88rem] leading-snug">
          {on ? (s.recordingKeepsAudio ? m.recorder.bannerAudio : m.recorder.banner) : m.recorder.bannerPaused}
          <span className="hidden text-mist sm:inline"> {m.recorder.othersReminder}</span>
        </p>
        <button
          type="button"
          onClick={() => (on ? recorderControls.pause() : recorderControls.resume())}
          className="min-h-11 shrink-0 rounded-full border border-[var(--hairline-strong)] px-4 text-[0.88rem] font-medium hover:border-paper/60"
        >
          {on ? m.recorder.pause : m.recorder.resume}
        </button>
        <button
          type="button"
          onClick={() => recorderControls.stop()}
          className="min-h-11 shrink-0 rounded-full px-3 text-[0.88rem] text-mist hover:text-paper"
        >
          {m.recorder.stop}
        </button>
      </div>
      )}
    </div>
  );
}
