import type { MomentTrigger } from "@/lib/shared/moments";
import type { MediaKeyAction } from "@/lib/shared/types";

/**
 * Gestures are what the wearer did physically; commands are what the app
 * does about it. The mapping between them is a user setting.
 *
 * Earbud media keys and the keyboard produce gestures, and so do Signalive
 * earbuds connected in Settings: their SensorProvider publishes the jaw
 * gestures (lib/extensions/signalive-provider.ts), which the keyboard can
 * also stand in for (J, K and H). Whisper detection is reserved for a
 * SensorProvider. triple_tap is included because earbuds commonly send
 * "previous track" for a triple tap.
 *
 * The jaw gestures carry the product: a double clench keeps the last seconds
 * as a moment, a clench plays them again (Rewind), and a clench held for
 * longer than 700 ms asks a question by voice. Keeping is on the double
 * clench because on real recordings a single clench fires by itself several
 * times an hour, mostly on swallows, and a double almost never
 * (research/ext/README.md).
 */
export const GESTURE_TYPES = [
  "tap",
  "double_tap",
  "triple_tap",
  "jaw_clench",
  "jaw_double_clench",
  "jaw_hold",
  "whisper_start",
  "whisper_end",
] as const;
export type GestureType = (typeof GESTURE_TYPES)[number];

/** The gestures Signalive earbuds make themselves; the rest come from buttons and keys. */
export const JAW_GESTURES: readonly GestureType[] = ["jaw_clench", "jaw_double_clench", "jaw_hold"];

export type GestureSource = "media_key" | "keyboard" | "sensor";

export interface GestureEvent {
  type: GestureType;
  source: GestureSource;
  /** performance.now() when the gesture was observed. */
  at: number;
  detail?: {
    mediaAction?: MediaKeyAction;
    key?: string;
    /** Sensor classifier confidence, 0..1, when a sensor produced it. */
    confidence?: number;
    /** How long after the movement began the sensor reported it, ms, when it knows. */
    latencyMs?: number;
    sensorId?: string;
  };
}

/** A gesture taken back by the sensor that reported it (GestureBus.withdraw). */
export interface GestureWithdrawal {
  type: GestureType;
  source: GestureSource;
  /** performance.now() when it was taken back. */
  at: number;
  /** The `at` of the GestureEvent it takes back. */
  of: number;
}

export const COMMANDS = [
  "none",
  "capture_moment",
  "ask_agent",
  "rewind",
  "toggle_listening",
  "mark_moment",
  "stop_recording",
  "toggle_recording",
  "stop_speaking",
  "lock_focus",
] as const;
export type Command = (typeof COMMANDS)[number];

export type GestureBindings = Record<GestureType, Command>;

export const DEFAULT_BINDINGS: GestureBindings = {
  tap: "toggle_listening",
  double_tap: "mark_moment",
  triple_tap: "stop_recording",
  jaw_clench: "rewind",
  jaw_double_clench: "capture_moment",
  jaw_hold: "ask_agent",
  whisper_start: "none",
  whisper_end: "none",
};

/** How a moment was asked for, from the gesture that asked: the earbuds' clench, a key, or an earbud button. */
export function momentTrigger(source: GestureSource | undefined): MomentTrigger {
  return source === "sensor" ? "clench" : source === "keyboard" ? "key" : "button";
}

/** How media session actions arrive as gestures. */
export const MEDIA_ACTION_GESTURE: Record<MediaKeyAction, GestureType> = {
  play: "tap",
  pause: "tap",
  nexttrack: "double_tap",
  previoustrack: "triple_tap",
};
