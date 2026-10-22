"use client";

import { gestureBus } from "@/lib/gestures/bus";
import { claimedCommand } from "@/lib/gestures/claims";
import { onMediaKeyFired, mediaKeys } from "@/lib/gestures/media-keys";
import { DEFAULT_BINDINGS, type Command } from "@/lib/gestures/types";
import { assistant } from "./assistant";
import { focus } from "./focus";
import { getPrefs } from "./prefs";
import { recorderControls } from "./recorder-controls";
import { rewind } from "./rewind";
import { saveDeviceProfile, sessionId } from "./session";

/**
 * Connects gestures to commands, using the user's bindings. The assistant
 * and the recorder never listen to raw buttons: anything that produces a
 * GestureEvent (earbud buttons today, jaw sensing later) drives them alike.
 */
export function runCommand(cmd: Command) {
  switch (cmd) {
    case "toggle_listening":
      void assistant.toggleListening();
      break;
    case "stop_speaking":
      assistant.stopSpeaking();
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
      break;
    case "lock_focus":
      focus.toggleLock();
      break;
    case "none":
      break;
  }
}

export function startCommandRouting(): () => void {
  const offGestures = gestureBus.subscribe((e) => {
    const bindings = { ...DEFAULT_BINDINGS, ...(getPrefs().gestureBindings ?? {}) };
    runCommand(claimedCommand(e.type) ?? bindings[e.type]);
  });
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
    offFired();
    if (pending) clearTimeout(pending);
  };
}
