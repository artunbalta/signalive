import { describe, expect, it } from "vitest";
import {
  buildIcs,
  escapeText,
  eventItem,
  foldLine,
  icsFileName,
  localDate,
  nextMorning,
  reminderItem,
  utcStamp,
  type CalendarItem,
} from "@/lib/client/moments-ics";

const octets = (s: string) => new TextEncoder().encode(s).length;
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe(".ics generation", () => {
  it("escapes text the way RFC 5545 asks", () => {
    expect(escapeText("Call Ayşe; then, the venue\\desk\nLine two")).toBe("Call Ayşe\\; then\\, the venue\\\\desk\\nLine two");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"Çağrı ve Şükrü ile İstanbul'da toplantı ".repeat(6)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    expect(unfold(folded)).toBe(line);
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("writes times in UTC, and whole days as dates", () => {
    expect(utcStamp(new Date("2026-11-06T15:00:00+03:00"))).toBe("20261106T120000Z");
    expect(localDate(new Date(2026, 10, 6))).toBe("20261106");
  });

  it("builds a calendar with one event per item, CRLF line ends and an alert", () => {
    const now = new Date("2026-11-02T10:00:00Z");
    const reminder = reminderItem("Call the venue, about the projector", "2026-11-03T09:30:00+03:00", { now, uid: "r1", notes: "Launch deck" });
    const event = eventItem({ title: "Deck review", start: "2026-11-06T15:00:00+03:00", end: null, location: "Moda" }, { uid: "e1" })!;
    const ics = buildIcs([reminder, event], now);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").filter((l) => l && !l.startsWith(" ") && !/^[A-Z-]+[;:]/.test(l))).toEqual([]);
    for (const l of ics.split("\r\n")) expect(octets(l)).toBeLessThanOrEqual(75);
    const text = unfold(ics);
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Signalive//Moments//EN")).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text.match(/END:VEVENT/g)).toHaveLength(2);
    expect(text).toContain("UID:r1@signalive");
    expect(text).toContain("DTSTAMP:20261102T100000Z");
    expect(text).toContain("DTSTART:20261103T063000Z");
    expect(text).toContain("DTEND:20261103T064500Z");
    expect(text).toContain("SUMMARY:Call the venue\\, about the projector");
    expect(text).toContain("DESCRIPTION:Launch deck");
    expect(text).toContain("TRIGGER:PT0M");
    expect(text).toContain("DTSTART:20261106T120000Z");
    expect(text).toContain("DTEND:20261106T130000Z");
    expect(text).toContain("LOCATION:Moda");
    expect(text).toContain("TRIGGER:-PT15M");
    expect(text.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("writes a whole day event with dates and no alert", () => {
    const item = eventItem({ title: "Launch day", start: "2026-11-10" }, { uid: "d" })!;
    expect(item).toMatchObject({ allDay: true, alarmMinutes: null });
    const text = unfold(buildIcs([item], new Date("2026-11-02T10:00:00Z")));
    expect(text).toContain("DTSTART;VALUE=DATE:20261110");
    expect(text).toContain("DTEND;VALUE=DATE:20261111");
    expect(text).not.toContain("BEGIN:VALARM");
  });
});

describe("when reminders and events happen", () => {
  it("reminds at the due time while it is ahead, at 9:00 on a due day, else the next morning", () => {
    const now = new Date(2026, 10, 2, 14, 0);
    const timed = reminderItem("A", "2026-11-04T16:00:00", { now, uid: "a" });
    expect(timed.start).toEqual(new Date(2026, 10, 4, 16, 0));
    expect(timed.end.getTime() - timed.start.getTime()).toBe(15 * 60_000);
    expect(reminderItem("B", "2026-11-05", { now, uid: "b" }).start).toEqual(new Date(2026, 10, 5, 9, 0));
    expect(reminderItem("C", null, { now, uid: "c" }).start).toEqual(new Date(2026, 10, 3, 9, 0));
    // Already past: the next morning, not a reminder nobody will see.
    expect(reminderItem("D", "2026-11-01T10:00:00", { now, uid: "d" }).start).toEqual(new Date(2026, 10, 3, 9, 0));
    expect(reminderItem("E", "soon", { now, uid: "e" }).start).toEqual(new Date(2026, 10, 3, 9, 0));
  });

  it("takes the next 9:00 at least an hour away", () => {
    expect(nextMorning(new Date(2026, 10, 2, 7, 0))).toEqual(new Date(2026, 10, 2, 9, 0));
    expect(nextMorning(new Date(2026, 10, 2, 8, 30))).toEqual(new Date(2026, 10, 3, 9, 0));
    expect(nextMorning(new Date(2026, 10, 2, 22, 0))).toEqual(new Date(2026, 10, 3, 9, 0));
  });

  it("lasts an hour unless an end was given after the start; no start, no event", () => {
    const one = eventItem({ title: "x", start: "2026-11-06T15:00:00+03:00", end: "2026-11-06T17:30:00+03:00" }, { uid: "1" })!;
    expect(one.end.getTime() - one.start.getTime()).toBe(150 * 60_000);
    const backwards = eventItem({ title: "x", start: "2026-11-06T15:00:00+03:00", end: "2026-11-06T14:00:00+03:00" }, { uid: "2" })!;
    expect(backwards.end.getTime() - backwards.start.getTime()).toBe(60 * 60_000);
    expect(eventItem({ title: "x", start: null }, { uid: "3" })).toBeNull();
    expect(eventItem({ title: "x", start: "Friday" }, { uid: "4" })).toBeNull();
  });

  it("names the file after the title, in any language", () => {
    expect(icsFileName("Call the venue, about the projector!")).toBe("signalive-call-the-venue-about-the-projector.ics");
    expect(icsFileName("Ayşe'ye sunumu gönder")).toBe("signalive-ayşe-ye-sunumu-gönder.ics");
    expect(icsFileName("!!!")).toBe("signalive.ics");
    expect(icsFileName("a".repeat(80)).length).toBeLessThanOrEqual("signalive-".length + 40 + ".ics".length);
  });

  it("keeps every item self-contained", () => {
    const item: CalendarItem = {
      kind: "event",
      uid: "u",
      title: "T",
      start: new Date("2026-11-06T12:00:00Z"),
      end: new Date("2026-11-06T13:00:00Z"),
      allDay: false,
      location: null,
      notes: null,
      alarmMinutes: null,
    };
    const text = buildIcs([item], new Date("2026-11-02T10:00:00Z"));
    expect(text).not.toContain("LOCATION");
    expect(text).not.toContain("DESCRIPTION");
    expect(text).not.toContain("VALARM");
  });
});
