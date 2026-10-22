"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Card";
import { fmtMs } from "@/components/ui/Readout";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { toMicError } from "@/lib/audio/devices";
import { assistant, type Turn } from "@/lib/client/assistant";
import { live } from "@/lib/client/live";
import { useStore } from "@/lib/client/store";
import { TalkRing } from "./TalkRing";

function typing(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/**
 * The ring, the live transcript and the conversation. Used on the assistant
 * screen and, compact, as the last step of setup.
 */
export function AssistantPanel({ compact = false, maxTurns = 20 }: { compact?: boolean; maxTurns?: number }) {
  const { m, f } = useI18n();
  const config = useConfig();
  const demo = config.llm.provider === "mock" || config.stt.provider === "mock";
  const view = useStore(assistant.view);
  const { assistant: state } = useStore(live);
  const [micError, setMicError] = useState<string | null>(null);

  const start = async () => {
    setMicError(null);
    try {
      await assistant.pressStart();
    } catch (err) {
      setMicError(toMicError(err).code);
    }
  };
  const end = () => void assistant.pressEnd();
  const toggle = async () => {
    setMicError(null);
    try {
      await assistant.activate();
      await assistant.toggleListening();
    } catch (err) {
      setMicError(toMicError(err).code);
    }
  };

  // Space bar: hold to talk anywhere on the page (the ring handles its own keys).
  useEffect(() => {
    let held = false;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e.target) || (e.target as HTMLElement)?.tagName === "BUTTON") return;
      e.preventDefault();
      if (assistant.view.get().handsFree) {
        void toggle();
        return;
      }
      held = true;
      void start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held) return;
      e.preventDefault();
      held = false;
      end();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listening = state === "listening" || state === "hearing";
  const hint = view.handsFree
    ? view.vad === "loading"
      ? m.assistant.handsFreeLoading
      : view.paused
        ? m.assistant.pausedHandsFree
        : m.assistant.listeningHandsFree
    : listening
      ? m.assistant.release
      : m.assistant.hold;
  const turns = view.turns.slice(0, maxTurns);

  return (
    <div className="flex flex-col items-center">
      {demo ? (
        <div className="mb-6 w-full max-w-2xl">
          <Callout kind="warn" title={m.assistant.mockTitle}>
            {m.assistant.mockBody}
          </Callout>
        </div>
      ) : null}
      <TalkRing
        state={state === "off" ? "idle" : state}
        handsFree={view.handsFree}
        label={view.handsFree ? m.assistant.handsFree : m.assistant.hold}
        hint={hint}
        onPressStart={start}
        onPressEnd={end}
        onToggle={toggle}
        size={compact ? 220 : 248}
      />
      <p className="t-label mt-3 hidden sm:block">{m.assistant.spaceHint}</p>

      <div className="mt-4 min-h-[1.75rem] max-w-xl px-2 text-center text-[1.02rem] text-mist" aria-live="polite">
        {view.partial ? <span className="text-paper">{view.partial}</span> : state === "searching" ? m.assistant.searchingNotes : null}
      </div>

      {state === "speaking" ? (
        <Button className="mt-2" icon="stop" onClick={() => assistant.stopSpeaking()}>
          {m.assistant.stop}
        </Button>
      ) : null}

      {micError ? <div className="mt-4 w-full max-w-xl"><ErrorCallout code={micError} /></div> : null}
      {view.error === "vad_failed" ? <div className="mt-4 w-full max-w-xl"><ErrorCallout code="vad_failed" /></div> : null}

      <ol className="mt-6 w-full max-w-2xl space-y-3" aria-label={m.assistant.title}>
        {turns.length === 0 && !compact ? <li className="text-center text-mist">{m.assistant.empty}</li> : null}
        {turns.map((t) => (
          <TurnItem key={t.id} turn={t} />
        ))}
      </ol>
    </div>
  );

  function TurnItem({ turn }: { turn: Turn }) {
    if (turn.status === "no_speech") {
      return (
        <li className="rounded-[12px] border border-[var(--hairline)] px-4 py-3 text-[0.92rem] text-mist">
          {m.errors.no_speech.title} {m.errors.no_speech.action}
        </li>
      );
    }
    return (
      <li className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well px-4 py-3.5">
        <p className="t-label">{m.assistant.you}</p>
        <p className="mt-1 leading-snug">{turn.user || "..."}</p>
        {turn.reply || turn.status === "pending" ? (
          <>
            <p className="t-label mt-3">{m.assistant.them}</p>
            <p className="mt-1 leading-snug text-mist">{turn.reply || "..."}</p>
          </>
        ) : null}
        {turn.status === "error" && turn.errorCode ? (
          <div className="mt-3">
            <ErrorCallout code={turn.errorCode} />
          </div>
        ) : null}
        <div className="t-mono mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem] text-fog">
          {turn.latencyMs !== undefined ? <span>{f(m.assistant.toFirstSound, { s: fmtMs(turn.latencyMs) })}</span> : null}
          {turn.searchedNotes ? <span>{m.assistant.searchingNotes}</span> : null}
        </div>
      </li>
    );
  }
}
