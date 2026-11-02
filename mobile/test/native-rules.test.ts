import { describe, expect, it } from "vitest";
import { bleFailure, type BleCodes } from "../src/native/ble-errors";
import { alarmOffsets, eventTimes, pickWritableCalendar } from "../src/native/calendar-rules";
import { NativeBridgeError } from "../src/shared";

describe("pickWritableCalendar", () => {
  const cal = (id: string, extra: Record<string, unknown> = {}) => ({ id, allowsModifications: true, isVisible: true, isSynced: true, accessLevel: "owner", ...extra });

  it("prefers a primary calendar the person can write to and sees", () => {
    expect(pickWritableCalendar([cal("holidays", { allowsModifications: false, isPrimary: true }), cal("work"), cal("me", { isPrimary: true })])?.id).toBe("me");
    expect(pickWritableCalendar([cal("hidden", { isPrimary: true, isVisible: false }), cal("work")])?.id).toBe("work");
    expect(pickWritableCalendar([cal("shared", { accessLevel: "read", isPrimary: true }), cal("local", { isSynced: false })])?.id).toBe("local");
    expect(pickWritableCalendar([cal("only", { isVisible: false })])?.id).toBe("only");
    expect(pickWritableCalendar([cal("ro", { allowsModifications: false }), cal("fb", { accessLevel: "freebusy" })])).toBeNull();
    expect(pickWritableCalendar([])).toBeNull();
  });
});

describe("eventTimes", () => {
  it("hands a timed event over as it is", () => {
    const t = eventTimes(Date.parse("2026-11-06T17:00:00Z"), Date.parse("2026-11-06T18:00:00Z"), false, "android");
    expect(t).toEqual({ startDate: new Date("2026-11-06T17:00:00Z"), endDate: new Date("2026-11-06T18:00:00Z"), allDay: false });
  });

  // An all day event as the trial makes it: local midnights, end exclusive (trial/lib/client/moments-ics.ts).
  const start = new Date(2026, 10, 6).getTime();
  const oneDay = new Date(2026, 10, 7).getTime();
  const threeDays = new Date(2026, 10, 9).getTime();

  it("gives iOS the first local midnight and the last day's end", () => {
    expect(eventTimes(start, oneDay, true, "ios")).toEqual({ startDate: new Date(2026, 10, 6), endDate: new Date(2026, 10, 6, 23, 59, 59), allDay: true });
    expect(eventTimes(start, threeDays, true, "ios").endDate).toEqual(new Date(2026, 10, 8, 23, 59, 59));
    // An end not after the start is still the one day.
    expect(eventTimes(start, start, true, "ios").endDate).toEqual(new Date(2026, 10, 6, 23, 59, 59));
  });

  it("gives Android UTC midnights of the same dates, end exclusive, in UTC", () => {
    expect(eventTimes(start, oneDay, true, "android")).toEqual({
      startDate: new Date(Date.UTC(2026, 10, 6)),
      endDate: new Date(Date.UTC(2026, 10, 7)),
      allDay: true,
      timeZone: "UTC",
    });
    expect(eventTimes(start, threeDays, true, "android").endDate).toEqual(new Date(Date.UTC(2026, 10, 9)));
  });
});

describe("alarmOffsets", () => {
  it("turns minutes before the start into expo-calendar's offsets", () => {
    expect(alarmOffsets(null)).toEqual([]);
    expect(alarmOffsets(0)).toEqual([{ relativeOffset: 0 }]);
    expect(alarmOffsets(15)).toEqual([{ relativeOffset: -15 }]);
  });
});

describe("bleFailure", () => {
  // The values react-native-ble-plx 3.5 gives its BleErrorCode.
  const codes: BleCodes = {
    OperationCancelled: 2,
    OperationTimedOut: 3,
    BluetoothUnsupported: 100,
    BluetoothUnauthorized: 101,
    BluetoothPoweredOff: 102,
    DeviceDisconnected: 201,
    DeviceNotFound: 204,
    DeviceNotConnected: 205,
    ServiceNotFound: 302,
    CharacteristicNotFound: 404,
    LocationServicesDisabled: 601,
  };

  it("maps the library's codes onto the bridge's", () => {
    const cases: [number, string][] = [
      [102, "bluetooth_off"],
      [101, "bluetooth_unauthorized"],
      [100, "unsupported"],
      [601, "location_off"],
      [204, "not_found"],
      [302, "not_found"],
      [205, "not_connected"],
      [201, "not_connected"],
      [3, "timeout"],
      [600, "failed"],
    ];
    for (const [errorCode, code] of cases) {
      const e = bleFailure({ errorCode, message: `ble ${errorCode}` }, codes);
      expect(e).toBeInstanceOf(NativeBridgeError);
      expect({ code: e.code, message: e.message }).toEqual({ code, message: `ble ${errorCode}` });
    }
    expect(bleFailure({ errorCode: 0, reason: "GATT 133" }, codes).message).toBe("GATT 133");
    expect(bleFailure(null, codes)).toMatchObject({ code: "failed", message: "Bluetooth failed" });
    const own = new NativeBridgeError("busy", "already scanning");
    expect(bleFailure(own, codes)).toBe(own);
  });
});
