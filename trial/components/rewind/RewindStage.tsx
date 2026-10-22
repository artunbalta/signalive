"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { rewind } from "@/lib/client/rewind";
import { useStore } from "@/lib/client/store";

/**
 * The stage: the three.js figure (loaded only on this screen), the time
 * readout, and the phase in words. Without WebGL a still drawing stands in;
 * Rewind itself works the same either way.
 */
export function RewindStage() {
  const { m, f } = useI18n();
  const v = useStore(rewind.view);
  const host = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const unit = m.rewind.secondsUnit;

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    import("./scene")
      .then(({ mountRewindScene }) => {
        if (cancelled || !host.current) return;
        try {
          cleanup = mountRewindScene(host.current, {
            reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            timeLabel: time.current,
            secondsUnit: unit,
          });
        } catch {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [unit]);

  const p = m.rewind.phases;
  const caption =
    v.phase === "rewinding" ? f(p.rewinding, { n: Math.round(v.clipSeconds) }) : p[v.phase];
  const live = v.phase !== "off" && v.phase !== "starting";

  return (
    <section
      className="relative h-[min(64vh,560px)] min-h-[360px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] lg:h-[640px]"
      style={{ background: "radial-gradient(110% 85% at 56% 36%, #18191d 0%, #101012 48%, #0b0b0c 78%)" }}
    >
      <div ref={host} className="absolute inset-0" role="img" aria-label={m.rewind.figureLabel} />
      {failed ? <StillFigure live={live} /> : null}
      <p className="t-label pointer-events-none absolute left-5 top-4">
        {live ? f(m.rewind.buffered, { n: Math.floor(v.buffered) }) : null}
      </p>
      <span
        ref={time}
        aria-hidden="true"
        className="t-mono pointer-events-none absolute right-5 top-3.5 text-[1.15rem] tabular-nums text-signal"
      />
      <p
        aria-live="polite"
        className={`pointer-events-none absolute inset-x-0 bottom-5 px-6 text-center text-[1.02rem] transition-colors duration-300 ${
          live && v.phase !== "listening" ? "text-paper" : "text-mist"
        }`}
      >
        {caption}
      </p>
    </section>
  );
}

/** A plain drawing of the same figure, for browsers without WebGL. */
function StillFigure({ live }: { live: boolean }) {
  return (
    <svg viewBox="0 0 400 420" className="absolute inset-0 m-auto h-[78%] w-auto" aria-hidden="true">
      <g fill="none" stroke="var(--color-mist)" strokeOpacity="0.55" strokeWidth="1.5">
        <path d="M200 60c-62 0-104 46-104 112 0 38 13 70 33 92 14 16 34 30 52 34h38c18-4 38-18 52-34 20-22 33-54 33-92 0-66-42-112-104-112Z" />
        <path d="M168 298v34c-52 6-96 28-118 64M232 298v34c52 6 96 28 118 64" />
        <path d="M296 160c10 2 16 14 14 28s-10 24-20 24" />
      </g>
      <circle cx="306" cy="186" r="9" fill={live ? "var(--color-signal)" : "var(--color-mist)"} />
    </svg>
  );
}
