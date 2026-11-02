"use client";

import { gestureBus } from "./bus";
import type { GestureType } from "./types";

/**
 * Keyboard as a gesture source: T, D and R stand in for earbud taps, J, K
 * and H for the jaw gestures Signalive earbuds make (a clench, a double
 * clench, a held clench). Ignored while typing. (The space bar is push to
 * talk, handled by the screens that offer it.)
 */
export const KEY_GESTURES: Readonly<Record<string, GestureType>> = {
  t: "tap",
  d: "double_tap",
  r: "triple_tap",
  j: "jaw_clench",
  k: "jaw_double_clench",
  h: "jaw_hold",
};

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function startKeyboardGestures(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const type = KEY_GESTURES[e.key.toLowerCase()];
    if (!type) return;
    gestureBus.emit({ type, source: "keyboard", at: performance.now(), detail: { key: e.key } });
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
