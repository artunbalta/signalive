"use client";

/**
 * Indirection between the always-mounted banner and the recorder, so the
 * banner can pause or stop a recording started on another screen without
 * importing the recorder (and its audio code) into every page.
 */
export interface RecorderControls {
  pause(): void;
  resume(): void;
  stop(): void;
  mark(): void;
  /** Starts recording if stopped (only from the recorder screen), else pauses or resumes. */
  toggle(): void;
}

const noop: RecorderControls = { pause() {}, resume() {}, stop() {}, mark() {}, toggle() {} };
let impl: RecorderControls = noop;

export const recorderControls: RecorderControls = {
  pause: () => impl.pause(),
  resume: () => impl.resume(),
  stop: () => impl.stop(),
  mark: () => impl.mark(),
  toggle: () => impl.toggle(),
};

export function registerRecorder(r: RecorderControls): () => void {
  impl = r;
  return () => {
    if (impl === r) impl = noop;
  };
}
