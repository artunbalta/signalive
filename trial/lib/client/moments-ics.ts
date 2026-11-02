import type { SignaliveNativeApi } from "@sense/native-protocol";
import { parseDue } from "./moments-format";

/**
 * Reminders and calendar events from moments and from Ask, as iCalendar
 * files (RFC 5545) the browser downloads, or, inside the Signalive app, as
 * items handed straight to the phone's calendar through the native shell.
 *
 * A reminder is an event with an alert at its own time: calendar apps import
 * events everywhere, while to-dos from a file are ignored by most of them.
 */

export interface CalendarItem {
  kind: "event" | "reminder";
  uid: string;
  title: string;
  start: Date;
  end: Date;
  /** Dates only: start and end are local midnights, end exclusive. */
  allDay: boolean;
  location: string | null;
  notes: string | null;
  /** Minutes before the start to alert; 0 for at the start; null for none. */
  alarmMinutes: number | null;
}

const MINUTE = 60_000;
const DEFAULT_HOUR = 9;

/** The next 9:00 at least an hour away: when a reminder with no time comes up. */
export function nextMorning(now: Date): Date {
  const d = new Date(now);
  d.setHours(DEFAULT_HOUR, 0, 0, 0);
  if (d.getTime() - now.getTime() < 60 * MINUTE) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * "Remind me": at the due time when one was said and it is still ahead, at
 * 9:00 on a due day without a time, otherwise the next morning.
 */
export function reminderItem(text: string, due: string | null, opts: { now: Date; uid: string; notes?: string | null }): CalendarItem {
  const p = parseDue(due);
  let start: Date;
  if (p && p.allDay) {
    start = new Date(p.at);
    start.setHours(DEFAULT_HOUR, 0, 0, 0);
  } else if (p) {
    start = p.at;
  } else {
    start = nextMorning(opts.now);
  }
  if (start.getTime() <= opts.now.getTime()) start = nextMorning(opts.now);
  return {
    kind: "reminder",
    uid: opts.uid,
    title: text,
    start,
    end: new Date(start.getTime() + 15 * MINUTE),
    allDay: false,
    location: null,
    notes: opts.notes ?? null,
    alarmMinutes: 0,
  };
}

/** "Add to calendar": an hour long unless an end was given; a date alone is a whole day. Null when start does not parse. */
export function eventItem(
  e: { title: string; start: string | null; end?: string | null; location?: string | null },
  opts: { uid: string; notes?: string | null },
): CalendarItem | null {
  const start = parseDue(e.start);
  if (!start) return null;
  const end = parseDue(e.end ?? null);
  let endAt: Date;
  if (start.allDay) {
    endAt = end?.allDay && end.at > start.at ? new Date(end.at.getTime() + 24 * 60 * MINUTE) : new Date(start.at.getTime() + 24 * 60 * MINUTE);
  } else {
    endAt = end && !end.allDay && end.at > start.at ? end.at : new Date(start.at.getTime() + 60 * MINUTE);
  }
  return {
    kind: "event",
    uid: opts.uid,
    title: e.title,
    start: start.at,
    end: endAt,
    allDay: start.allDay,
    location: e.location?.trim() || null,
    notes: opts.notes ?? null,
    alarmMinutes: start.allDay ? null : 15,
  };
}

/* ---- The file ---------------------------------------------------------------- */

/** TEXT values: backslash, semicolon, comma and line breaks escaped. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * Content lines longer than 75 octets continue on the next line after a
 * space. Folds fall between characters, never inside one, so Turkish
 * letters and other multibyte characters survive.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      // The leading space of a continuation line counts toward its 75.
      limit = 74;
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 20261106T120000Z */
export function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** 20261106, the local calendar date. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function buildIcs(items: CalendarItem[], now: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Signalive//Moments//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const it of items) {
    lines.push("BEGIN:VEVENT", `UID:${it.uid}@signalive`, `DTSTAMP:${utcStamp(now)}`);
    if (it.allDay) lines.push(`DTSTART;VALUE=DATE:${localDate(it.start)}`, `DTEND;VALUE=DATE:${localDate(it.end)}`);
    else lines.push(`DTSTART:${utcStamp(it.start)}`, `DTEND:${utcStamp(it.end)}`);
    lines.push(`SUMMARY:${escapeText(it.title)}`);
    if (it.location) lines.push(`LOCATION:${escapeText(it.location)}`);
    if (it.notes) lines.push(`DESCRIPTION:${escapeText(it.notes)}`);
    if (it.alarmMinutes !== null) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(it.title)}`,
        it.alarmMinutes === 0 ? "TRIGGER:PT0M" : `TRIGGER:-PT${it.alarmMinutes}M`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** "signalive-send-the-deck.ics": letters and digits of any language, at most 40 of them. */
export function icsFileName(title: string): string {
  const slug = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `signalive${slug ? `-${slug}` : ""}.ics`;
}

/* ---- Where it goes --------------------------------------------------------------- */

/**
 * The Signalive app's bridge (the native shell in mobile/, its messages in
 * lib/sense/native-protocol.ts), when this page runs inside the app. Every
 * part is checked before use: an older shell may lack one, and a browser has
 * none.
 */
export function nativeApi(): Partial<SignaliveNativeApi> | null {
  if (typeof window === "undefined") return null;
  const v = (window as unknown as { SignaliveNative?: unknown }).SignaliveNative;
  return v && typeof v === "object" ? (v as Partial<SignaliveNativeApi>) : null;
}

export function nativeCalendar(): SignaliveNativeApi["calendar"] | null {
  const c = nativeApi()?.calendar;
  return c && typeof c.addEvent === "function" ? c : null;
}

/** Hands a file to the browser as a download. */
export function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Into the phone's calendar when the Signalive app provides one, else an
 * .ics download (which opens the calendar's own add screen on iOS and
 * Android). Resolves with where it went; rejects when the native calendar
 * refused.
 */
export async function addToCalendar(item: CalendarItem): Promise<"native" | "file"> {
  const native = nativeCalendar();
  if (native) {
    if (item.kind === "reminder" && typeof native.addReminder === "function") {
      // On Android, which has no reminders, the shell makes it an event with an alert.
      await native.addReminder({ title: item.title, due: item.start.toISOString(), notes: item.notes });
    } else {
      await native.addEvent({
        title: item.title,
        start: item.start.toISOString(),
        end: item.end.toISOString(),
        allDay: item.allDay,
        location: item.location,
        notes: item.notes,
        alarmMinutes: item.alarmMinutes,
      });
    }
    return "native";
  }
  saveFile(icsFileName(item.title), buildIcs([item]), "text/calendar;charset=utf-8");
  return "file";
}
