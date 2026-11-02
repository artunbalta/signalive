import { NativeBridgeError, type NativeErrorCode } from "../shared";

/**
 * The react-native-ble-plx error codes (its BleErrorCode) this shell tells
 * apart. Passed in rather than imported, so this mapping runs in the tests
 * without the native library.
 */
export interface BleCodes {
  OperationCancelled: number;
  OperationTimedOut: number;
  BluetoothUnsupported: number;
  BluetoothUnauthorized: number;
  BluetoothPoweredOff: number;
  DeviceDisconnected: number;
  DeviceNotFound: number;
  DeviceNotConnected: number;
  ServiceNotFound: number;
  CharacteristicNotFound: number;
  LocationServicesDisabled: number;
}

/** A Bluetooth library error as a bridge error the page can act on. */
export function bleFailure(e: unknown, codes: BleCodes): NativeBridgeError {
  if (e instanceof NativeBridgeError) return e;
  const o = (typeof e === "object" && e !== null ? e : {}) as { errorCode?: unknown; message?: unknown; reason?: unknown };
  const message =
    typeof o.message === "string" && o.message ? o.message : typeof o.reason === "string" && o.reason ? o.reason : "Bluetooth failed";
  const table: [number, NativeErrorCode][] = [
    [codes.BluetoothPoweredOff, "bluetooth_off"],
    [codes.BluetoothUnauthorized, "bluetooth_unauthorized"],
    [codes.BluetoothUnsupported, "unsupported"],
    [codes.LocationServicesDisabled, "location_off"],
    [codes.DeviceNotFound, "not_found"],
    [codes.ServiceNotFound, "not_found"],
    [codes.CharacteristicNotFound, "not_found"],
    [codes.DeviceNotConnected, "not_connected"],
    [codes.DeviceDisconnected, "not_connected"],
    [codes.OperationCancelled, "not_connected"],
    [codes.OperationTimedOut, "timeout"],
  ];
  const hit = table.find(([code]) => code === o.errorCode);
  return new NativeBridgeError(hit ? hit[1] : "failed", message);
}
