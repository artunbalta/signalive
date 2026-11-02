"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Spinner } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { agent } from "@/lib/client/agent";
import { micManager } from "@/lib/client/mic-manager";
import { useStore } from "@/lib/client/store";
import type { Moment } from "@/lib/shared/moments";
import styles from "@/components/moments/motion.module.css";

function typing(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/**
 * Where questions are asked, above the navigation: type and send, or hold
 * the mic (or the space bar) and speak. While a question is spoken the mic
 * is amber, the attended signal, and its ring follows the voice.
 */
export function Composer({ about, onClearAbout }: { about: Moment | null; onClearAbout: () => void }) {
  const { m, f } = useI18n();
  const view = useStore(agent.view);
  const [text, setText] = useState("");
  const last = view.turns.at(-1);
  const answering = last?.status === "pending" || last?.status === "streaming" || view.speaking;
  const listening = view.voice === "listening" || view.voice === "starting";

  // The space bar is push to talk here too, unless the wearer is typing.
  useEffect(() => {
    let held = false;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e.target) || (e.target as HTMLElement | null)?.tagName === "BUTTON") return;
      e.preventDefault();
      held = true;
      void agent.startVoice("hold");
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held) return;
      e.preventDefault();
      held = false;
      agent.endVoice();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    void agent.ask(q, { focusMomentId: about?.id ?? null });
    setText("");
    onClearAbout();
  };

  let status: React.ReactNode = null;
  if (view.voice === "starting" || view.voice === "listening") {
    status = (
      <>
        <span className="h-2 w-2 shrink-0 rounded-full bg-signal" aria-hidden="true" />
        <span className={view.partial ? "text-paper" : ""}>{view.partial || (view.voiceMode === "auto" ? m.ask.voicePill : m.ask.release)}</span>
      </>
    );
  } else if (view.voice === "transcribing") {
    status = (
      <>
        <Spinner size={13} />
        <span>{m.ask.transcribing}</span>
      </>
    );
  } else if (view.speaking) {
    status = (
      <>
        <Icon name="speaker" size={14} />
        <span>{m.ask.speaking}</span>
      </>
    );
  } else if (view.voiceError === "no_speech") {
    status = <span>{m.ask.noSpeech}</span>;
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 px-4 pb-3 pt-8 sm:px-6"
      style={{
        bottom: "calc(var(--nav-h) + env(safe-area-inset-bottom))",
        background: "linear-gradient(to top, var(--color-ink) 58%, rgba(11, 11, 12, 0))",
      }}
    >
      <div className="pointer-events-auto mx-auto max-w-[760px]">
        <div className="mb-2.5 flex min-h-5 items-center gap-2 text-[0.85rem] text-mist" aria-live="polite">
          {status}
          {answering ? (
            <button
              type="button"
              onClick={() => agent.stop()}
              className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--hairline-strong)] px-3 text-[0.82rem] text-paper hover:border-paper/60"
            >
              <Icon name="stop" size={13} />
              {m.ask.stop}
            </button>
          ) : null}
        </div>
        {about ? (
          <div className="mb-2.5 flex">
            <span className="flex min-h-9 max-w-full items-center gap-2 rounded-full bg-well-2 pl-3.5 pr-1 text-[0.85rem] text-mist">
              <Icon name="moment" size={14} />
              <span className="truncate">{f(m.ask.about, { title: about.title })}</span>
              <button type="button" onClick={onClearAbout} aria-label={m.ask.clearAbout} className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:text-paper">
                <Icon name="close" size={14} />
              </button>
            </span>
          </div>
        ) : null}
        <form className="flex items-center gap-2" onSubmit={submit}>
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{m.ask.placeholder}</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={listening ? "" : m.ask.placeholder}
              enterKeyHint="send"
              autoComplete="off"
              maxLength={4000}
              className="min-h-12 w-full rounded-full border border-[var(--hairline-strong)] bg-well py-3 pl-5 pr-14 text-[1rem] placeholder:text-fog"
            />
            <button
              type="submit"
              aria-label={m.ask.send}
              disabled={!text.trim()}
              className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-paper text-ink transition-opacity duration-200 disabled:opacity-25"
            >
              <Icon name="send" size={16} />
            </button>
          </label>
          <MicButton listening={listening} label={listening ? m.ask.release : m.ask.hold} />
        </form>
      </div>
    </div>
  );
}

/** Hold to ask: pointer, or Space and Enter while it has focus. */
function MicButton({ listening, label }: { listening: boolean; label: string }) {
  const ring = useRef<HTMLSpanElement>(null);
  const pressed = useRef(false);

  // The ring follows the live level while a question is spoken.
  useEffect(() => {
    if (!listening) return;
    let raf = 0;
    let smooth = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const db = micManager.mic?.level.rmsDb ?? -90;
      smooth = smooth * 0.7 + Math.max(0, Math.min(1, (db + 60) / 45)) * 0.3;
      if (ring.current && !reduced) ring.current.style.transform = `scale(${1 + smooth * 0.45})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [listening]);

  const start = () => {
    if (pressed.current) return;
    pressed.current = true;
    void agent.startVoice("hold");
  };
  const end = () => {
    if (!pressed.current) return;
    pressed.current = false;
    agent.endVoice();
  };

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={listening}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          end();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative grid h-12 w-12 shrink-0 touch-none select-none place-items-center rounded-full border transition-colors duration-200 [-webkit-touch-callout:none] ${
        listening ? "border-signal bg-[rgba(255,194,75,0.1)] text-signal" : "border-[var(--hairline-strong)] bg-well text-paper hover:border-paper/60"
      }`}
    >
      {listening ? (
        <>
          <span ref={ring} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border border-signal/70 transition-transform duration-75" />
          <span aria-hidden="true" className={`pointer-events-none absolute -inset-1.5 rounded-full border border-signal/40 ${styles.breathe}`} />
        </>
      ) : null}
      <Icon name="mic" size={20} />
    </button>
  );
}
