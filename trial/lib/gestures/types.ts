import type { MediaKeyAction } from "@/lib/shared/types";

/**
 * Gestures are what the wearer did physically; commands are what the app
 * does about it. The mapping between them is a user setting.
 *
 * Today only earbud media keys and the keyboard produce gestures. Jaw
 * gestures and whisper detection are reserved for a SensorProvider (see
 * lib/extensions/sensor-provider.ts) and can be simulated from the keyboard.
 * triple_tap is included because earbuds commonly send "previous track" for
 * a triple tap; it is the one addition to the six gestures in the brief.
 */
export const GESTURE_TYPES = [
  "tap",
  "double_tap",
  "triple_tap",
  "jaw_clench",
  "jaw_double_clench",
  "whisper_start",
  "whisper_end",
] as const;
export type GestureType = (typeof GESTURE_TYPES)[number];

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
    sensorId?: string;
  };
}

export const COMMANDS = [
  "none",
  "toggle_listening",
  "mark_moment",
  "stop_recording",
  "toggle_recording",
  "stop_speaking",
  "rewind",
  "lock_focus",
] as const;
export type Command = (typeof COMMANDS)[number];

export type GestureBindings = Record<GestureType, Command>;

export const DEFAULT_BINDINGS: GestureBindings = {
  tap: "toggle_listening",
  double_tap: "mark_moment",
  triple_tap: "stop_recording",
  jaw_clench: "rewind",
  jaw_double_clench: "mark_moment",
  whisper_start: "none",
  whisper_end: "none",
};

/** How media session actions arrive as gestures. */
export const MEDIA_ACTION_GESTURE: Record<MediaKeyAction, GestureType> = {
  play: "tap",
  pause: "tap",
  nexttrack: "double_tap",
  previoustrack: "triple_tap",
};
