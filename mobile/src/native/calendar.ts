import * as Calendar from "expo-calendar";
import * as LegacyCalendar from "expo-calendar/legacy";
import { Platform } from "react-native";
import { NativeBridgeError, type CalendarItemResult, type NativeParams } from "../shared";
import { alarmOffsets, eventTimes, pickWritableCalendar } from "./calendar-rules";

/** A reminder on Android, which has none, is an event this long with an alert at its start. */
const REMINDER_EVENT_MS = 15 * 60 * 1000;
const PLATFORM: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";

/** The phone's time zone, for timed events: they happen at an instant, wherever the phone travels. */
function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Android wants each alarm's method; an on screen alert is what a reminder means. */
function alarms(alarmMinutes: number | null) {
  return alarmOffsets(alarmMinutes).map((a) => (PLATFORM === "android" ? { ...a, method: Calendar.AlarmMethod.ALERT } : a));
}

/**
 * Where new events go. On iPhone, write only access is enough (iOS 17 and
 * later): the app adds events without being able to read the calendar, and
 * the default calendar takes them. Android has no default, so a writable,
 * visible, preferably primary calendar is chosen.
 */
async function eventCalendar(): Promise<Calendar.ExpoCalendar> {
  if (PLATFORM === "ios") {
    const permission = await Calendar.requestCalendarPermissions(true);
    if (!permission.granted) throw new NativeBridgeError("permission_denied", "Calendar access was not allowed");
    return Calendar.getDefaultCalendarSync();
  }
  const permission = await Calendar.requestCalendarPermissions();
  if (!permission.granted) throw new NativeBridgeError("permission_denied", "Calendar access was not allowed");
  const chosen = pickWritableCalendar(await Calendar.getCalendars());
  if (!chosen) throw new NativeBridgeError("not_found", "No calendar on this phone takes new events");
  return chosen;
}

export async function addEvent(p: NativeParams["calendar.addEvent"]): Promise<CalendarItemResult> {
  const calendar = await eventCalendar();
  const times = eventTimes(p.start, p.end, p.allDay, PLATFORM);
  // An all day event on iPhone floats (no time zone): it is that date wherever the phone is.
  const timeZone = times.allDay ? times.timeZone : deviceTimeZone();
  const event = await calendar.createEvent({
    title: p.title,
    startDate: times.startDate,
    endDate: times.endDate,
    allDay: times.allDay,
    ...(timeZone ? { timeZone } : {}),
    ...(p.location ? { location: p.location } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
    alarms: alarms(p.alarmMinutes),
  });
  return { id: event.id, kind: "event" };
}

/**
 * A reminder in the person's default Reminders list on iPhone. That list is
 * reachable only through expo-calendar's legacy API (the newer one needs a
 * list named), hence the import. Android has no reminders: one with a due
 * time becomes a short calendar event with an alert, and says so in `kind`.
 */
export async function addReminder(p: NativeParams["calendar.addReminder"]): Promise<CalendarItemResult> {
  if (PLATFORM === "ios") {
    const permission = await LegacyCalendar.requestRemindersPermissionsAsync();
    if (!permission.granted) throw new NativeBridgeError("permission_denied", "Reminders access was not allowed");
    const id = await LegacyCalendar.createReminderAsync(null, {
      title: p.title,
      ...(p.notes ? { notes: p.notes } : {}),
      ...(p.due === null ? {} : { dueDate: new Date(p.due), alarms: alarmOffsets(0) }),
    });
    return { id, kind: "reminder" };
  }
  if (p.due === null) {
    throw new NativeBridgeError("unsupported", "Android has no reminders; one with a due time is added to the calendar instead");
  }
  const calendar = await eventCalendar();
  const timeZone = deviceTimeZone();
  const event = await calendar.createEvent({
    title: p.title,
    startDate: new Date(p.due),
    endDate: new Date(p.due + REMINDER_EVENT_MS),
    ...(timeZone ? { timeZone } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
    alarms: alarms(0),
  });
  return { id: event.id, kind: "event" };
}
