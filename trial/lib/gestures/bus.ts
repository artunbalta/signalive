import type { GestureEvent } from "./types";

type Listener = (e: GestureEvent) => void;

/**
 * A typed, synchronous event stream of gestures. The assistant and the
 * recorder subscribe; media keys, the keyboard, and later earbud sensors
 * publish. Kept free of React and of browser APIs so it can be tested and
 * fed from anywhere.
 */
export class GestureBus {
  private listeners = new Set<Listener>();
  private recent: GestureEvent[] = [];

  emit(e: GestureEvent) {
    this.recent = [e, ...this.recent].slice(0, 20);
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        // One faulty subscriber must not swallow the gesture for the others.
        console.error("gesture listener failed", err);
      }
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Newest first. */
  history(): readonly GestureEvent[] {
    return this.recent;
  }
}

export const gestureBus = new GestureBus();
