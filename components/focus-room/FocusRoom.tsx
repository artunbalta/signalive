"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { focusRoom, hero as heroCopy } from "@/lib/copy";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { FocusRoomEngine } from "./engine";

type Props = {
  /** The hero section: the canvas covers it. */
  hero: HTMLElement;
  /** The part of the layout the room is composed into; its labels and controls go in here. */
  slot: HTMLElement;
};

/**
 * The room at the top of the page: three people talking around you, the one
 * you turn to comes forward, and a clench plays back the last ten seconds of
 * that person. The canvas covers the whole hero with no frame of its own;
 * each speaker's label rides over their head, and the room's controls sit at
 * the top of its slot in the layout. The styles are the .room-* rules in
 * globals.css.
 */
export default function FocusRoom({ hero, slot }: Props) {
  const reduced = useReducedMotion();
  const [engine] = useState(() => new FocusRoomEngine());
  const v = useSyncExternalStore(engine.subscribe, engine.get, engine.get);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const meters = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!canvas.current || !controls.current) return;
    return engine.mount({ hero, slot, canvas: canvas.current, controls: controls.current, labels: labels.current, meters: meters.current }, reduced);
  }, [engine, hero, slot, reduced]);

  const replay = v.replay;
  const replayed = v.replaying && replay ? replay.speaker : null;

  return (
    <>
      <canvas ref={canvas} aria-hidden="true" data-intro-fade className="pointer-events-none absolute inset-0 h-full w-full" />

      {createPortal(
        <>
          {/* The room's controls: sound, and the clench. Above the room beside
              the copy; under it when stacked, so the people come first. */}
          <div
            ref={controls}
            data-room-hold
            className="absolute inset-x-0 bottom-0 z-30 flex flex-col items-start gap-3 lg:top-0 lg:bottom-auto lg:items-end"
          >
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                className="room-pill"
                onClick={() => void engine.toggleSound()}
                aria-pressed={v.sound === "on"}
                disabled={v.sound === "loading"}
              >
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                  <path d={v.sound === "on" ? "M3 8h3l4-4v12l-4-4H3zm10-2c3 2 3 6 0 8m2-10c5 3 5 9 0 12" : "M3 8h3l4-4v12l-4-4H3zm10 0 4 4m0-4-4 4"} />
                </svg>
                {{ on: heroCopy.mute, loading: focusRoom.loading, error: focusRoom.soundError, off: heroCopy.unmute }[v.sound]}
              </button>
              <button type="button" className="room-pill" onClick={() => void engine.clench()} aria-describedby="room-hint">
                <span aria-hidden="true" className="room-dot" data-on={v.replaying || undefined} />
                {focusRoom.clench}
                <kbd className="room-kbd">J</kbd>
              </button>
            </div>
            {/* Worded for a mouse and keys, or for a finger: the stylesheet shows one. */}
            <p id="room-hint" className="room-hint">
              <span className="room-fine">
                {heroCopy.interactionCaption}. {focusRoom.clenchHint}
              </span>
              <span className="room-coarse">
                {heroCopy.interactionCaptionTouch}. {focusRoom.clenchHintTouch}
              </span>{" "}
              {focusRoom.aiVoices}
            </p>
          </div>

          {/* Each speaker's name (which turns you to them), what they talk
              about and how loud you hear them, over their head. */}
          <div data-intro-fade className="pointer-events-none absolute inset-0 z-20" role="group" aria-label={focusRoom.label}>
            {focusRoom.speakers.map((s, i) => (
              <div
                key={s.name}
                className="room-label"
                ref={(el) => {
                  labels.current[i] = el;
                }}
              >
                <p className="room-state t-mono" data-on={v.attended === i || replayed === i || undefined} data-live={replayed === i || undefined}>
                  {replayed === i ? focusRoom.replaying : v.attended === i ? focusRoom.forward : ""}
                </p>
                <button type="button" className="room-name" onClick={() => engine.face(i)} aria-label={`${focusRoom.turnTo} ${s.name}`} aria-pressed={v.attended === i}>
                  <b>{s.name}</b>
                  <span>{s.topic}</span>
                </button>
                <span aria-hidden="true" className="room-meter" data-on={v.attended === i || undefined}>
                  <span
                    ref={(el) => {
                      meters.current[i] = el;
                    }}
                  />
                </span>
              </div>
            ))}
          </div>

          {/* The last clench, at the room's foot: whose ten seconds, and the
              words lighting up as they are said again. Always mounted so the
              live region is in the tree before it has anything to say. */}
          <div
            data-room-hold
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--room-foot,0px)+12px)] z-30 flex justify-end"
          >
            {replay ? (
              <section className="room-recap">
                <div className="flex items-center gap-3">
                  {v.replaying ? <span aria-hidden="true" className="room-dot" data-on /> : null}
                  <p className="t-mono text-fog">
                    {focusRoom.replayHeading} <span className="text-paper">{focusRoom.speakers[replay.speaker].name}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => engine.closeReplay()}
                    aria-label={focusRoom.close}
                    className="-my-2 ml-auto grid h-10 w-10 place-items-center rounded-full text-mist hover:text-paper"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                      <path d="m3.5 3.5 9 9m0-9-9 9" />
                    </svg>
                  </button>
                </div>
                <p key={replay.id} className="room-words">
                  {replay.words
                    ? replay.words.map(([w, s], k) => (
                        <span key={k} style={{ animationDelay: `${s}s` }}>
                          {w}{" "}
                        </span>
                      ))
                    : focusRoom.loading}
                </p>
              </section>
            ) : null}
          </div>
        </>,
        slot,
      )}
    </>
  );
}
