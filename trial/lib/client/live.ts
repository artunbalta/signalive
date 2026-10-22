"use client";

import { createStore } from "./store";

/**
 * What the status strip shows: the devices in use, the assistant's state,
 * the last measured latency, and whether anything is being recorded.
 */
export type AssistantState =
  | "off"
  | "idle"
  | "listening"
  | "hearing"
  | "transcribing"
  | "thinking"
  | "searching"
  | "speaking"
  | "error";

export interface LiveState {
  micOpen: boolean;
  inputLabel: string | null;
  outputLabel: string | null;
  contextRate: number | null;
  trackRate: number | null;
  assistant: AssistantState;
  /** Capture end to playback start of the last reply, ms. */
  lastLatencyMs: number | null;
  recording: "off" | "on" | "paused";
  recordingKeepsAudio: boolean;
  /** Rewind is keeping the last seconds of the microphone in memory. */
  rewindOn: boolean;
  /** A microphone vanished (earbuds disconnected, permission revoked). */
  micLost: boolean;
  /**
   * The browser suspended audio (iOS does this when the page is hidden, on a
   * call, or for Siri) and it needs a tap to resume.
   */
  audioSuspended: boolean;
}

export const live = createStore<LiveState>({
  micOpen: false,
  inputLabel: null,
  outputLabel: null,
  contextRate: null,
  trackRate: null,
  assistant: "off",
  lastLatencyMs: null,
  recording: "off",
  recordingKeepsAudio: false,
  rewindOn: false,
  micLost: false,
  audioSuspended: false,
});
