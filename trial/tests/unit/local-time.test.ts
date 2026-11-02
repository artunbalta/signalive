import { describe, expect, it } from "vitest";
import { describeTime, localClock, normalizeIsoTime, validTimeZone } from "@/lib/server/local-time";

const SERVER_NOW = Date.parse("2026-11-02T11:05:00Z");

describe("localClock", () => {
  it("gives the wearer's time with the zone's offset and the weekday", () => {
    expect(localClock("2026-11-02T14:05:00+03:00", "Europe/Istanbul", SERVER_NOW)).toBe("Monday 2026-11-02T14:05:00+03:00 (Europe/Istanbul)");
    // A UTC timestamp is shown in the wearer's zone.
    expect(localClock("2026-11-02T23:30:00.000Z", "Europe/Istanbul", SERVER_NOW)).toBe("Tuesday 2026-11-03T02:30:00+03:00 (Europe/Istanbul)");
    expect(localClock("2026-11-02T11:05:00Z", "America/New_York", SERVER_NOW)).toBe("Monday 2026-11-02T06:05:00-05:00 (America/New_York)");
  });

  it("takes the timestamp next to a localized date, which may be older than the server's clock", () => {
    const anHourLater = SERVER_NOW + 3_600_000;
    expect(localClock("Monday, 2 November 2026 at 14:05 (2026-11-02T14:05+03:00)", "Europe/Istanbul", anHourLater)).toBe(
      "Monday 2026-11-02T14:05:00+03:00 (Europe/Istanbul)",
    );
    expect(localClock("2 Kasım 2026 Pazartesi 14:05 (2026-11-02T14:05+0300)", null, anHourLater)).toBe("Monday 2026-11-02T14:05:00+03:00");
  });

  it("leaves the instant to the server's clock when the device sent a localized string alone", () => {
    expect(localClock("Monday, 2 November 2026 at 14:05", "Europe/Istanbul", SERVER_NOW)).toBe("Monday 2026-11-02T14:05:00+03:00 (Europe/Istanbul)");
  });

  it("uses a timestamp's own offset without a zone, and says when the zone is unknown", () => {
    expect(localClock("2026-11-02T14:05:00+03:00", null, SERVER_NOW)).toBe("Monday 2026-11-02T14:05:00+03:00");
    expect(localClock("2 Kasım 2026 14:05", "Not/AZone", SERVER_NOW)).toBe(
      "Monday 2026-11-02T11:05:00+00:00 (UTC; the wearer's time zone is unknown)",
    );
  });
});

describe("normalizeIsoTime", () => {
  it("keeps dates and timestamps with an offset", () => {
    expect(normalizeIsoTime("2026-11-06", "Europe/Istanbul")).toBe("2026-11-06");
    expect(normalizeIsoTime("2026-11-06T15:00:00+03:00", null)).toBe("2026-11-06T15:00:00+03:00");
    expect(normalizeIsoTime("2026-11-06T15:00+0300", null)).toBe("2026-11-06T15:00:00+03:00");
    expect(normalizeIsoTime("2026-11-06T12:00:00.000Z", null)).toBe("2026-11-06T12:00:00Z");
  });

  it("gives a local time the offset of the wearer's zone on that date", () => {
    expect(normalizeIsoTime("2026-11-06T15:00", "Europe/Istanbul")).toBe("2026-11-06T15:00:00+03:00");
    // New York leaves summer time on 2026-11-01.
    expect(normalizeIsoTime("2026-10-31T09:00:00", "America/New_York")).toBe("2026-10-31T09:00:00-04:00");
    expect(normalizeIsoTime("2026-11-02T09:00:00", "America/New_York")).toBe("2026-11-02T09:00:00-05:00");
    expect(normalizeIsoTime("2026-11-06T15:00", null)).toBe("2026-11-06T15:00:00");
  });

  it("refuses what is not a real date or time", () => {
    for (const bad of ["Friday at 3", "2026-02-30", "2026-11-06T25:00", "2026-11-06T10:61", "06/11/2026", "", "  "]) {
      expect(normalizeIsoTime(bad, "Europe/Istanbul")).toBeNull();
    }
    expect(normalizeIsoTime(null, "Europe/Istanbul")).toBeNull();
  });
});

describe("describeTime", () => {
  it("shows when a moment was kept in the wearer's zone", () => {
    expect(describeTime("2026-10-30T12:04:00.000Z", "Europe/Istanbul")).toBe("Fri, 30 Oct 2026, 15:04");
    expect(describeTime("2026-10-30T12:04:00.000Z", null)).toBe("Fri, 30 Oct 2026, 12:04 UTC");
    expect(describeTime("yesterday", "Europe/Istanbul")).toBe("yesterday");
  });

  it("knows a real zone from a made up one", () => {
    expect(validTimeZone("Europe/Istanbul")).toBe("Europe/Istanbul");
    expect(validTimeZone("Mars/Olympus")).toBeNull();
    expect(validTimeZone(null)).toBeNull();
  });
});
