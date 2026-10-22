"use client";

import { gestureBus } from "./bus";
import type { GestureType } from "./types";

/**
 * Keyboard as a gesture source: T, D and R stand in for earbud taps, J and K
 * for the jaw gestures a future sensor will produce. Ignored while typing.
 * (The space bar is push to talk and handled by the assistant itself.)
 */
const KEYS: Record<string, GestureType> = {
  t: "tap",
  d: "double_tap",
  r: "triple_tap",
  j: "jaw_clench",
  k: "jaw_double_clench",
};

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function startKeyboardGestures(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const type = KEYS[e.key.toLowerCase()];
    if (!type) return;
    gestureBus.emit({ type, source: "keyboard", at: performance.now(), detail: { key: e.key } });
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
