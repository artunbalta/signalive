/**
 * The calendar's decisions, apart from the calendar itself so the tests can
 * hold them: which calendar takes a new event on Android, and what times an
 * event is handed over with.
 */

/** What the choice needs to know about a calendar (expo-calendar's ExpoCalendar has all of it on Android). */
export interface CalendarChoice {
  id: string;
  allowsModifications: boolean;
  isPrimary?: boolean;
  isVisible?: boolean;
  isSynced?: boolean;
  accessLevel?: string;
}

/** Access levels that may add events to a calendar. */
const WRITERS = new Set(["owner", "editor", "contributor", "root"]);

/**
 * Where a new event goes on Android, which has no default calendar: a primary
 * calendar the person can write to and sees, else any synced one they can
 * write to and see, else any they can write to; null when there is none.
 */
export function pickWritableCalendar<T extends CalendarChoice>(calendars: readonly T[]): T | null {
  const writable = calendars.filter((c) => c.allowsModifications && (c.accessLevel === undefined || WRITERS.has(c.accessLevel)));
  const visible = writable.filter((c) => c.isVisible !== false);
  return visible.find((c) => c.isPrimary === true) ?? visible.find((c) => c.isSynced !== false) ?? visible[0] ?? writable[0] ?? null;
}

export interface EventTimes {
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  /** Set only where the calendar needs one other than the phone's. */
  timeZone?: string;
}

/**
 * The times to hand the calendar. A timed event goes as it is. An all day
 * event arrives as local midnights with an exclusive end (as in an .ics
 * file), and each platform wants it its own way: iOS (EventKit) takes the
 * first day's midnight and the last day's end, in local time; Android's
 * calendar provider wants UTC midnights, the end exclusive, in UTC, or it
 * moves the event to the UTC date of the local midnight, a day early east of
 * Greenwich.
 */
export function eventTimes(start: number, end: number, allDay: boolean, platform: "ios" | "android"): EventTimes {
  if (!allDay) return { startDate: new Date(start), endDate: new Date(end), allDay: false };
  const first = new Date(start);
  // The day holding the last instant before the exclusive end; at least the first day.
  const last = new Date(Math.max(end - 1, start));
  if (platform === "android") {
    return {
      startDate: new Date(Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())),
      endDate: new Date(Date.UTC(last.getFullYear(), last.getMonth(), last.getDate() + 1)),
      allDay: true,
      timeZone: "UTC",
    };
  }
  return {
    startDate: new Date(first.getFullYear(), first.getMonth(), first.getDate()),
    endDate: new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59),
    allDay: true,
  };
}

/** expo-calendar's alarm offsets are minutes from the start, negative before it. */
export function alarmOffsets(alarmMinutes: number | null): { relativeOffset: number }[] {
  return alarmMinutes === null ? [] : [{ relativeOffset: alarmMinutes === 0 ? 0 : -alarmMinutes }];
}
