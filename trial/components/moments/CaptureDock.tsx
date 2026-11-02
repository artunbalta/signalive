"use client";

import { useI18n } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { moments } from "@/lib/client/moments";
import { rewind } from "@/lib/client/rewind";
import { useStore } from "@/lib/client/store";

/**
 * The one action of the Moments screen, where a thumb rests: Start listening
 * while the microphone is off, Keep this moment while it listens. It sits
 * above the navigation and stays there while the feed scrolls under it.
 */
export function CaptureDock() {
  const { m, f } = useI18n();
  const rw = useStore(rewind.view);
  const on = rw.phase !== "off" && rw.phase !== "starting";
  const starting = rw.phase === "starting";

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 px-4 pb-3 pt-8 sm:px-6"
      style={{
        bottom: "calc(var(--nav-h) + env(safe-area-inset-bottom))",
        background: "linear-gradient(to top, var(--color-ink) 58%, rgba(11, 11, 12, 0))",
      }}
    >
      <div className="pointer-events-auto mx-auto max-w-[760px]">
        <div className="t-mono mb-2.5 flex items-center gap-2 text-[0.72rem] text-mist" aria-live="polite">
          {on ? (
            <>
              <span className="rec-dot !h-2 !w-2" aria-hidden="true" />
              <span>{f(m.moments.listening.on, { n: Math.round(rw.buffered) })}</span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full border border-fog" aria-hidden="true" />
              <span>{starting ? m.moments.listening.starting : m.moments.listening.offTitle}</span>
            </>
          )}
          {on ? <span className="ml-auto hidden text-fog sm:inline">{m.moments.keepKey}</span> : null}
        </div>
        {on ? (
          <Button variant="primary" size="lg" icon="moment" className="w-full" onClick={() => void moments.capture("button")}>
            {m.moments.keep}
            <kbd className="t-mono ml-1 hidden rounded-[6px] border border-ink/25 px-1.5 py-0.5 text-[0.72rem] text-ink/70 sm:inline">J</kbd>
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon="mic" className="w-full" busy={starting} onClick={() => void rewind.enable()}>
            {starting ? m.moments.listening.starting : m.moments.listening.start}
          </Button>
        )}
      </div>
    </div>
  );
}
