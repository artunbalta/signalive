import * as Location from "expo-location";
import { NativeBridgeError, type NativeLocation, type NativeParams } from "../shared";

const ACCURACY = {
  low: Location.Accuracy.Low,
  balanced: Location.Accuracy.Balanced,
  high: Location.Accuracy.High,
} as const;

/** A fix can take a while indoors; past this the page gets "timeout" rather than waiting on. */
const FIX_TIMEOUT_MS = 30000;

/** Where the phone is now, with permission asked for while the app is in use (never in the background). */
export async function currentLocation(p: NativeParams["location.current"]): Promise<NativeLocation> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new NativeBridgeError("permission_denied", "Location access was not allowed");
  if (!(await Location.hasServicesEnabledAsync())) throw new NativeBridgeError("location_off", "Location services are off");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NativeBridgeError("timeout", "No location fix in time")), FIX_TIMEOUT_MS);
  });
  try {
    const fix = await Promise.race([Location.getCurrentPositionAsync({ accuracy: ACCURACY[p.accuracy] }), timeout]);
    return {
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? null,
      altitude: fix.coords.altitude ?? null,
      timestamp: fix.timestamp,
    };
  } finally {
    clearTimeout(timer);
  }
}
