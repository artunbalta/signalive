"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Button } from "@/components/ui/Button";
import { focus } from "@/lib/client/focus";
import { headTracker } from "@/lib/client/head-tracker";
import { useStore } from "@/lib/client/store";
import { FOCUS_SPEAKERS } from "@/lib/shared/focus";

/** How much of a voice you hear: -30 dB and below reads as empty. */
function Meter({ db, label, forward }: { db: number; label: string; forward: boolean }) {
  const shown = Number.isFinite(db) ? Math.max(-40, Math.min(0, db)) : -40;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={-40}
      aria-valuemax={0}
      aria-valuenow={shown}
      className="h-[3px] w-16 overflow-hidden rounded-full bg-white/[0.12]"
    >
      <div
        className={`h-full rounded-full transition-[width,background-color] duration-150 ${forward ? "bg-signal" : "bg-paper"}`}
        style={{ width: `${Math.max(0, (shown + 30) / 30) * 100}%` }}
      />
    </div>
  );
}

/**
 * The room (three.js, loaded only on this screen) with no frame around it:
 * it fades into the page at its foot. Over each speaker's head, their name
 * (which turns you to them), what they talk about, how loud you hear them,
 * and the question; and a small mirrored preview while the camera steers.
 */
export function FocusStage() {
  const { m, f, locale } = useI18n();
  const v = useStore(focus.view);
  const t = useStore(headTracker.view);
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const preview = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const lang = locale === "tr" ? "tr" : "en";
  const playing = v.phase === "playing";

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    import("./scene")
      .then(({ mountFocusScene }) => {
        if (cancelled || !host.current) return;
        try {
          cleanup = mountFocusScene(host.current, {
            reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
            labels: labels.current,
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
  }, []);

  const showPreview = t.source === "camera" && (t.status === "tracking" || t.status === "no_face");
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    el.srcObject = showPreview ? (headTracker.video?.srcObject ?? null) : null;
    if (el.srcObject) void el.play().catch(() => undefined);
  }, [showPreview]);

  return (
    <section className="relative h-[min(72vh,660px)] min-h-[460px] lg:h-[720px]">
      {/* No frame: the room fades out at its foot and its sides. */}
      <div
        ref={host}
        className="absolute inset-0 [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,black_78%,transparent),linear-gradient(to_right,transparent,black_7%,black_93%,transparent)]"
        role="img"
        aria-label={m.focus.figureLabel}
      />
      {FOCUS_SPEAKERS.map((s, i) => {
        const forward = v.attended === i;
        const state = v.locked === i ? m.focus.locked : forward ? m.focus.forward : "";
        return (
          <div
            key={s.sourceId}
            ref={(el) => {
              labels.current[i] = el;
            }}
            className="pointer-events-none absolute left-0 top-0 flex w-max flex-col items-center pb-3 text-center will-change-transform"
          >
            <p className={`t-label h-4 transition-opacity duration-300 ${state ? "opacity-100" : "opacity-0"} ${v.locked === i ? "text-signal" : ""}`}>
              {state}
            </p>
            <button
              type="button"
              onClick={() => focus.face(i)}
              disabled={t.source !== "pointer"}
              className="pointer-events-auto mt-0.5 rounded-[8px] px-1 disabled:cursor-default"
            >
              <span className={`block text-[1.05rem] font-medium transition-colors duration-300 ${forward ? "text-signal" : "text-paper"}`}>
                {s.name[lang]}
              </span>
              <span className="mt-0.5 hidden text-[0.82rem] text-mist sm:block">{s.topic[lang]}</span>
            </button>
            <div className="mt-2.5">
              <Meter db={v.gainsDb[i] ?? -Infinity} label={f(m.focus.level, { name: s.name[lang], n: v.gainsDb[i] ?? -40 })} forward={forward} />
            </div>
            <div className="hidden sm:block">
              <Button
                disabled={!playing}
                onClick={() => void focus.recap(i)}
                className="pointer-events-auto mt-2.5 bg-ink/40 px-4 text-[0.85rem] backdrop-blur-[2px]"
              >
                {m.focus.whatDidTheySay}
              </Button>
            </div>
          </div>
        );
      })}
      {/* Too narrow for the question over each head: a row of its own. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 sm:hidden">
        <p className="t-label w-full">{m.focus.whatDidTheySay}</p>
        {FOCUS_SPEAKERS.map((s, i) => (
          <Button key={s.sourceId} disabled={!playing} onClick={() => void focus.recap(i)} className="px-4 text-[0.9rem]">
            {s.name[lang]}
          </Button>
        ))}
      </div>
      <video
        ref={preview}
        muted
        playsInline
        aria-label={m.focus.preview}
        className={`absolute bottom-4 left-4 h-[84px] w-[112px] -scale-x-100 rounded-[10px] border border-[var(--hairline-strong)] object-cover opacity-80 ${showPreview ? "" : "hidden"}`}
      />
      {failed ? (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-8 text-center text-mist">{m.focus.figureLabel}</p>
      ) : null}
    </section>
  );
}
