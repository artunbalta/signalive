import type { GestureEvent, GestureWithdrawal } from "./types";

type Listener = (e: GestureEvent) => void;
type WithdrawListener = (w: GestureWithdrawal) => void;

/**
 * A typed, synchronous event stream of gestures. The assistant and the
 * recorder subscribe; media keys, the keyboard, and later earbud sensors
 * publish. Kept free of React and of browser APIs so it can be tested and
 * fed from anywhere.
 */
export class GestureBus {
  private listeners = new Set<Listener>();
  private withdrawListeners = new Set<WithdrawListener>();
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

  /**
   * A gesture emitted a moment ago was not one: the earbuds took a bite of
   * food for a clench, say, and found out at the next bites. Whatever acted
   * on it should call that off.
   */
  withdraw(w: GestureWithdrawal) {
    this.recent = this.recent.filter((e) => !(e.at === w.of && e.type === w.type));
    for (const l of [...this.withdrawListeners]) {
      try {
        l(w);
      } catch (err) {
        console.error("gesture withdrawal listener failed", err);
      }
    }
  }

  onWithdraw(l: WithdrawListener): () => void {
    this.withdrawListeners.add(l);
    return () => this.withdrawListeners.delete(l);
  }

  /** Newest first. */
  history(): readonly GestureEvent[] {
    return this.recent;
  }
}

export const gestureBus = new GestureBus();
