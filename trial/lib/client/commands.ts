"use client";

import { gestureBus } from "@/lib/gestures/bus";
import { claimedCommand } from "@/lib/gestures/claims";
import { onMediaKeyFired, mediaKeys } from "@/lib/gestures/media-keys";
import { DEFAULT_BINDINGS, momentTrigger, type Command, type GestureEvent, type GestureWithdrawal } from "@/lib/gestures/types";
import { agent } from "./agent";
import { assistant } from "./assistant";
import { focus } from "./focus";
import { moments } from "./moments";
import { getPrefs } from "./prefs";
import { recorderControls } from "./recorder-controls";
import { rewind } from "./rewind";
import { saveDeviceProfile, sessionId } from "./session";

/**
 * Connects gestures to commands, using the user's bindings. The assistant,
 * the recorder and moments never listen to raw buttons: anything that
 * produces a GestureEvent (earbud buttons, the keyboard, the earbuds' jaw
 * clench) drives them alike.
 */

/**
 * What the earbuds' gestures did lately, so that one the earbuds take back
 * (a bite of food read as a clench, found out at the next bites) can be
 * undone: the moment it began is called off, the replay or the lock it
 * started is ended.
 */
const acted: { at: number; cmd: Command; capture: Promise<string | null> | null; t: number }[] = [];
const ACTED_KEEP_MS = 8000;

function remember(e: GestureEvent | undefined, cmd: Command, capture: Promise<string | null> | null = null) {
  if (e?.source !== "sensor") return;
  const now = performance.now();
  while (acted.length && now - acted[0]!.t > ACTED_KEEP_MS) acted.shift();
  acted.push({ at: e.at, cmd, capture, t: now });
}

export function undoWithdrawn(w: GestureWithdrawal) {
  const i = acted.findIndex((a) => a.at === w.of);
  if (i < 0) return;
  const [a] = acted.splice(i, 1);
  switch (a!.cmd) {
    case "capture_moment":
      void a!.capture?.then((id) => id && moments.withdraw(id));
      break;
    case "rewind":
      rewind.stop();
      break;
    case "lock_focus":
      focus.toggleLock();
      break;
    default:
      break;
  }
}

export function runCommand(cmd: Command, e?: GestureEvent) {
  switch (cmd) {
    case "capture_moment":
      remember(e, cmd, moments.capture(momentTrigger(e?.source)));
      break;
    case "ask_agent":
      agent.toggleVoice();
      break;
    case "toggle_listening":
      void assistant.toggleListening();
      break;
    case "stop_speaking":
      assistant.stopSpeaking();
      agent.stopSpeaking();
      moments.stopSpeaking();
      break;
    case "mark_moment":
      recorderControls.mark();
      break;
    case "stop_recording":
      recorderControls.stop();
      break;
    case "toggle_recording":
      recorderControls.toggle();
      break;
    case "rewind":
      void rewind.trigger();
      remember(e, cmd);
      break;
    case "lock_focus":
      focus.toggleLock();
      remember(e, cmd);
      break;
    case "none":
      break;
  }
}

export function startCommandRouting(): () => void {
  const offGestures = gestureBus.subscribe((e) => {
    const bindings = { ...DEFAULT_BINDINGS, ...(getPrefs().gestureBindings ?? {}) };
    runCommand(claimedCommand(e.type) ?? bindings[e.type], e);
  });
  const offWithdrawn = gestureBus.onWithdraw(undoWithdrawn);
  // What actually fired goes into this session's device profile.
  let pending: ReturnType<typeof setTimeout> | null = null;
  const offFired = onMediaKeyFired(() => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      if (sessionId()) void saveDeviceProfile({ mediaKeys: mediaKeys.get().status }).catch(() => undefined);
    }, 1500);
  });
  return () => {
    offGestures();
    offWithdrawn();
    offFired();
    if (pending) clearTimeout(pending);
  };
}
