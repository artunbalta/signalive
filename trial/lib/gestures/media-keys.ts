"use client";

import { MEDIA_KEY_ACTIONS, type MediaKeyAction, type MediaKeyStatus } from "@/lib/shared/types";
import { encodeWav } from "@/lib/shared/audio/wav";
import { createStore } from "@/lib/client/store";
import { gestureBus } from "./bus";
import { MEDIA_ACTION_GESTURE } from "./types";

/**
 * Earbud buttons through the Media Session API. Browsers send play, pause and
 * track actions to the page that is playing media, so a looping, near silent
 * track keeps this page in that role. Support varies by browser, platform and
 * earbud (and some earbuds stop sending media buttons while their microphone
 * is in use), so every action that actually arrives is counted and shown.
 */

export type MediaKeysState = {
  enabled: boolean;
  supported: boolean;
  status: Record<MediaKeyAction, MediaKeyStatus>;
};

const initialStatus = () =>
  Object.fromEntries(MEDIA_KEY_ACTIONS.map((a) => [a, { bound: false, fired: 0, lastFiredAt: null }])) as Record<
    MediaKeyAction,
    MediaKeyStatus
  >;

export const mediaKeys = createStore<MediaKeysState>({
  enabled: false,
  supported: typeof navigator !== "undefined" && "mediaSession" in navigator,
  status: initialStatus(),
});

let audio: HTMLAudioElement | null = null;
let url: string | null = null;
const firedListeners = new Set<(action: MediaKeyAction) => void>();

/**
 * Two seconds of noise at about -84 dBFS: inaudible, but some platforms
 * ignore digitally silent media and would not route the buttons.
 */
function nearSilentTrack(): string {
  const rate = 8000;
  const samples = new Int16Array(rate * 2);
  let seed = 1;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = (seed % 5) - 2;
  }
  return URL.createObjectURL(new Blob([encodeWav(samples, rate) as BlobPart], { type: "audio/wav" }));
}

/** Must be called from a user gesture (it starts media playback). */
export async function enableMediaKeys(): Promise<boolean> {
  if (!("mediaSession" in navigator)) {
    mediaKeys.set({ supported: false });
    return false;
  }
  url ??= nearSilentTrack();
  audio ??= Object.assign(new Audio(url), { loop: true, preload: "auto" });
  audio.setAttribute("playsinline", "");
  try {
    await audio.play();
  } catch {
    return false;
  }
  navigator.mediaSession.metadata = new MediaMetadata({ title: "Signalive", artist: "Web trial" });
  navigator.mediaSession.playbackState = "playing";
  const status = { ...mediaKeys.get().status };
  for (const action of MEDIA_KEY_ACTIONS) {
    try {
      navigator.mediaSession.setActionHandler(action, () => onAction(action));
      status[action] = { ...status[action], bound: true };
    } catch {
      status[action] = { ...status[action], bound: false };
    }
  }
  mediaKeys.set({ enabled: true, status });
  return true;
}

export function disableMediaKeys() {
  if ("mediaSession" in navigator) {
    for (const action of MEDIA_KEY_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // not supported
      }
    }
  }
  audio?.pause();
  mediaKeys.set({ enabled: false });
}

function onAction(action: MediaKeyAction) {
  // Keep the page as the media session owner whatever the button was.
  if (audio && audio.paused) void audio.play().catch(() => undefined);
  navigator.mediaSession.playbackState = "playing";
  const status = { ...mediaKeys.get().status };
  status[action] = { bound: true, fired: status[action].fired + 1, lastFiredAt: new Date().toISOString() };
  mediaKeys.set({ status });
  gestureBus.emit({ type: MEDIA_ACTION_GESTURE[action], source: "media_key", at: performance.now(), detail: { mediaAction: action } });
  for (const l of firedListeners) l(action);
}

export function onMediaKeyFired(l: (action: MediaKeyAction) => void): () => void {
  firedListeners.add(l);
  return () => firedListeners.delete(l);
}
