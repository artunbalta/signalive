"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Controls";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useI18n } from "@/components/providers/AppProviders";
import { focus } from "@/lib/client/focus";
import { headTracker, type TrackingSource } from "@/lib/client/head-tracker";
import { useStore } from "@/lib/client/store";
import { FOCUS_SPEAKERS } from "@/lib/shared/focus";
import { FocusStage } from "./FocusStage";

function typing(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/**
 * Focus: three voices around you; the one you face comes forward. Steer with
 * the camera, the phone, or keys and pointer; clench (J) to lock; ask what
 * anyone said.
 */
export function FocusPanel() {
  const { m, f, locale } = useI18n();
  const v = useStore(focus.view);
  const t = useStore(headTracker.view);
  const lang = locale === "tr" ? "tr" : "en";
  const playing = v.phase === "playing";
  const [touch, setTouch] = useState(false);
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    // Leaving the screen stops the room and the camera.
    return () => focus.stop();
  }, []);

  // Is there a camera at all? A Mac mini has none until an iPhone joins as
  // one (Continuity Camera), so keep watching for it to arrive.
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) {
      setHasCamera(false);
      return;
    }
    const check = () =>
      media
        .enumerateDevices()
        .then((d) => setHasCamera(d.some((x) => x.kind === "videoinput")))
        .catch(() => setHasCamera(false));
    void check();
    media.addEventListener("devicechange", check);
    return () => media.removeEventListener("devicechange", check);
  }, []);

  // Without a camera, the keys and the pointer steer.
  useEffect(() => {
    if (hasCamera === false && headTracker.view.get().source === "camera") void headTracker.use("pointer");
  }, [hasCamera]);

  // The voices load while the screen is read, so Start plays at once.
  useEffect(() => {
    focus.preload(lang).catch(() => undefined);
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        headTracker.nudge(e.key === "ArrowLeft" ? -10 : 10);
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        focus.face(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sources: { value: TrackingSource; label: string }[] = [
    ...(hasCamera === false ? [] : [{ value: "camera" as const, label: m.focus.sources.camera }]),
    ...(touch ? [{ value: "motion" as const, label: m.focus.sources.motion }] : []),
    { value: "pointer", label: m.focus.sources.pointer },
  ];
  const note = t.source === "camera" ? m.focus.cameraNote : t.source === "motion" ? m.focus.motionNote : m.focus.pointerNote;
  const ownError = v.error === "focus_nobody" || v.error === "rewind_empty" ? m.focus.errors[v.error] : null;
  const recapName = v.recap ? FOCUS_SPEAKERS[v.recap.speaker]!.name[lang] : "";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
      <FocusStage />

      <div className="flex flex-col gap-6 lg:pt-2">
        <header className="rise">
          <h1 className="t-display text-[clamp(2rem,4.2vw,2.7rem)] leading-[1.04]">{m.focus.title}</h1>
          <p className="mt-3 max-w-[48ch] text-[1.02rem] leading-relaxed text-mist">{m.focus.lead}</p>
        </header>

        <div className="rise rise-1">
          {playing ? (
            <Button size="lg" icon="stop" onClick={() => focus.stop()}>
              {m.focus.stop}
            </Button>
          ) : (
            <Button variant="primary" size="lg" icon="play" busy={v.phase === "loading"} onClick={() => void focus.start(lang)}>
              {v.phase === "loading" ? f(m.focus.loading, { n: v.loaded }) : m.focus.start}
            </Button>
          )}
        </div>

        <div className="rise rise-2 space-y-2.5">
          <p className="t-label">{m.focus.steerWith}</p>
          <Segmented label={m.focus.steerWith} value={t.source} onChange={(s) => void headTracker.use(s)} options={sources} />
          {hasCamera === false ? <p className="text-[0.88rem] leading-relaxed text-mist">{m.focus.noCamera}</p> : null}
          <p className="text-[0.88rem] leading-relaxed text-fog">
            {note}
            {t.status !== "idle" && m.focus.status[t.status] ? (
              <span className={`ml-1 ${t.status === "tracking" ? "text-paper" : "text-mist"}`}>{m.focus.status[t.status]}</span>
            ) : null}
          </p>
          {t.source !== "pointer" && t.status === "tracking" ? (
            <Button onClick={() => headTracker.recenter()}>{m.focus.recenter}</Button>
          ) : null}
        </div>

        <div className="space-y-2.5">
          <Button
            variant={v.locked !== null ? "primary" : "secondary"}
            size="lg"
            icon="lock"
            disabled={!playing}
            onClick={() => focus.toggleLock()}
          >
            {v.locked !== null ? m.focus.unlock : m.focus.lock}
            <kbd className="t-mono ml-1 hidden rounded-[6px] border border-current/30 px-1.5 py-0.5 text-[0.72rem] opacity-70 sm:inline">J</kbd>
          </Button>
          <p className="max-w-[52ch] text-[0.88rem] leading-relaxed text-fog">{m.focus.lockHint}</p>
        </div>

        {ownError ? <Callout kind="warn" title={ownError} /> : v.error ? <ErrorCallout code={v.error} /> : null}

        {v.recap ? (
          <section className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well px-5 py-4" aria-live="polite">
            <p className="t-label">{f(m.focus.recapTitle, { name: recapName })}</p>
            <p className="mt-1.5 text-[1.05rem] leading-relaxed">{v.recap.text || (v.recap.thinking ? "..." : "")}</p>
            {v.recap.transcript ? (
              <>
                <p className="t-label mt-4">{m.focus.heard}</p>
                <p className="mt-1.5 text-[0.9rem] leading-relaxed text-mist">{v.recap.transcript}</p>
              </>
            ) : null}
            {v.recap.error ? (
              <div className="mt-3">
                <ErrorCallout code={v.recap.error} />
              </div>
            ) : null}
          </section>
        ) : null}

        <p className="max-w-[56ch] text-[0.84rem] leading-relaxed text-fog">{m.focus.honest}</p>
      </div>
    </div>
  );
}
