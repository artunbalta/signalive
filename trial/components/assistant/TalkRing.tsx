"use client";

import { useEffect, useRef } from "react";
import type { AssistantState } from "@/lib/client/live";
import { micManager } from "@/lib/client/mic-manager";

/**
 * The push to talk control. Hold it (pointer, Space or Enter) to talk; in
 * hands-free mode a tap switches listening on and off. The three outer rings
 * follow the live input level. They are amber only while the assistant is
 * listening, which is what amber means across Signalive: the attended signal.
 */

const LISTENING: AssistantState[] = ["listening", "hearing"];
const BUSY: AssistantState[] = ["transcribing", "thinking", "searching"];

export function TalkRing({
  state,
  handsFree,
  label,
  hint,
  onPressStart,
  onPressEnd,
  onToggle,
  size = 248,
}: {
  state: AssistantState;
  handsFree: boolean;
  label: string;
  hint: string;
  onPressStart: () => void;
  onPressEnd: () => void;
  onToggle: () => void;
  size?: number;
}) {
  const rings = useRef<(SVGCircleElement | null)[]>([]);
  const pressed = useRef(false);
  const listening = LISTENING.includes(state);
  const busy = BUSY.includes(state);
  const speaking = state === "speaking";

  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const mic = micManager.mic;
      const db = mic && listening ? mic.level.rmsDb : -90;
      const target = Math.max(0, Math.min(1, (db + 60) / 45));
      smooth = smooth * 0.75 + target * 0.25;
      rings.current.forEach((el, i) => {
        if (!el) return;
        const base = 92 + i * 15;
        const r = reduced ? base : base + smooth * (8 + i * 7);
        el.setAttribute("r", r.toFixed(1));
        el.setAttribute("opacity", (listening ? 0.85 - i * 0.22 : 0.22 - i * 0.05).toFixed(2));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [listening]);

  const down = (e: React.PointerEvent) => {
    if (handsFree) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    onPressStart();
  };
  const up = () => {
    if (!pressed.current) return;
    pressed.current = false;
    onPressEnd();
  };
  const key = (e: React.KeyboardEvent, isDown: boolean) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (handsFree) {
      if (isDown && !e.repeat) onToggle();
      return;
    }
    if (isDown && !e.repeat && !pressed.current) {
      pressed.current = true;
      onPressStart();
    } else if (!isDown) up();
  };

  const stroke = listening ? "var(--color-signal)" : "var(--color-paper)";

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        aria-label={label}
        aria-pressed={handsFree ? listening : pressed.current || listening}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onClick={() => handsFree && onToggle()}
        onKeyDown={(e) => key(e, true)}
        onKeyUp={(e) => key(e, false)}
        onContextMenu={(e) => e.preventDefault()}
        className="relative grid touch-none select-none place-items-center rounded-full [-webkit-touch-callout:none] [-webkit-user-select:none]"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 280 280" width={size} height={size} className="absolute inset-0" aria-hidden="true">
          <style>{`
            @keyframes ring-speak { 0%,100% { transform: scale(1); opacity: .5 } 50% { transform: scale(1.06); opacity: .15 } }
            @media (prefers-reduced-motion: reduce) { .ring-speak, .ring-busy { animation: none !important } }
          `}</style>
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              ref={(el) => {
                rings.current[i] = el;
              }}
              cx="140"
              cy="140"
              r={92 + i * 15}
              fill="none"
              stroke={stroke}
              strokeWidth={i === 0 ? 1.5 : 1}
            />
          ))}
          {speaking ? (
            <circle
              className="ring-speak"
              cx="140"
              cy="140"
              r="122"
              fill="none"
              stroke="var(--color-paper)"
              strokeWidth="1"
              style={{ transformOrigin: "140px 140px", animation: "ring-speak 1.6s ease-in-out infinite" }}
            />
          ) : null}
          {busy ? (
            <circle
              className="ring-busy spin"
              cx="140"
              cy="140"
              r="84"
              fill="none"
              stroke="var(--color-mist)"
              strokeWidth="1.5"
              strokeDasharray="4 10"
              style={{ transformOrigin: "140px 140px" }}
            />
          ) : null}
          <circle
            cx="140"
            cy="140"
            r="76"
            fill={listening ? "rgba(255,194,75,0.08)" : "var(--color-well-2)"}
            stroke={listening ? "var(--color-signal)" : "var(--hairline-strong)"}
            strokeWidth="1.5"
          />
        </svg>
        <span className="relative z-10 flex max-w-[150px] flex-col items-center gap-1.5 text-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={listening ? "var(--color-signal)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3" />
          </svg>
          <span className="text-[0.95rem] font-medium leading-tight">{hint}</span>
        </span>
      </button>
    </div>
  );
}
