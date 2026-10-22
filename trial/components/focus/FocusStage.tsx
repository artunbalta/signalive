"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { focus } from "@/lib/client/focus";
import { headTracker } from "@/lib/client/head-tracker";
import { useStore } from "@/lib/client/store";
import { FOCUS_SPEAKERS } from "@/lib/shared/focus";

/**
 * The room (three.js, loaded only on this screen), each speaker's name over
 * their head, and a small mirrored preview while the camera steers.
 */
export function FocusStage() {
  const { m, locale } = useI18n();
  const v = useStore(focus.view);
  const t = useStore(headTracker.view);
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const preview = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const lang = locale === "tr" ? "tr" : "en";

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
    <section
      className="relative h-[min(66vh,600px)] min-h-[380px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] lg:h-[660px]"
      style={{ background: "radial-gradient(120% 90% at 50% 30%, #18191d 0%, #101012 50%, #0b0b0c 80%)" }}
    >
      <div ref={host} className="absolute inset-0" role="img" aria-label={m.focus.figureLabel} />
      {FOCUS_SPEAKERS.map((s, i) => (
        <div
          key={s.sourceId}
          ref={(el) => {
            labels.current[i] = el;
          }}
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap pb-2 text-center will-change-transform"
        >
          <p className={`text-[0.95rem] font-medium transition-colors duration-300 ${v.attended === i ? "text-signal" : "text-paper"}`}>
            {s.name[lang]}
          </p>
          <p className="t-label mt-0.5">{v.locked === i ? m.focus.locked : v.attended === i ? m.focus.forward : s.topic[lang]}</p>
        </div>
      ))}
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
