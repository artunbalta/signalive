import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { NATIVE_METHODS, NATIVE_PROTOCOL_VERSION, type HapticStyle, type NativeInfo } from "../shared";
import type { Handlers } from "../bridge/router";
import type { BleController } from "./ble";
import { addEvent, addReminder } from "./calendar";
import { currentLocation } from "./location";

const IMPACT: Record<HapticStyle, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  soft: Haptics.ImpactFeedbackStyle.Soft,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
};

export function appInfo(ble: BleController): NativeInfo {
  return {
    platform: Platform.OS === "ios" ? "ios" : "android",
    version: Constants.expoConfig?.version ?? "0.0.0",
    os: String(Platform.Version),
    bridge: NATIVE_PROTOCOL_VERSION,
    ble: ble.available,
    methods: [...NATIVE_METHODS],
  };
}

/** Every bridge method, on the phone's own modules. */
export function nativeHandlers(ble: BleController): Handlers {
  return {
    info: () => appInfo(ble),
    "ble.scan": (p) => ble.scan(p),
    "ble.connect": (p) => ble.connect(p),
    "ble.disconnect": (p) => ble.disconnect(p),
    "ble.write": (p) => ble.write(p),
    "calendar.addEvent": addEvent,
    "calendar.addReminder": addReminder,
    "haptics.impact": async (p) => {
      await Haptics.impactAsync(IMPACT[p.style]);
      return null;
    },
    "location.current": currentLocation,
  };
}
