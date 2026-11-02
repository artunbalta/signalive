import "server-only";

/**
 * The wearer's clock, for prompts that turn "Friday at 3" into a timestamp.
 * The model gets the current local time as ISO 8601 with the zone's UTC
 * offset, and every time it writes back is checked here and given that
 * offset when it came without one.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** The zone if Intl knows it, else null. */
export function validTimeZone(timeZone: string | null | undefined): string | null {
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}

/** The zone's offset from UTC at an instant, in minutes. */
export function zoneOffsetMinutes(timeZone: string, at: number): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(new Date(at))
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

const formatOffset = (minutes: number) => {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

/** An offset as written in ISO 8601 ("+0300", "+03:00"), in minutes. */
const parseOffset = (offset: string) =>
  offset === "Z" ? 0 : (offset[0] === "-" ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(-2)));

/** A timestamp with an offset anywhere in a string, as in "Monday, 2 November 2026 at 14:05 (2026-11-02T14:05+03:00)". */
const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})/;

/**
 * The wearer's local date and time for a prompt, such as
 * "Monday 2026-11-02T14:05:00+03:00 (Europe/Istanbul)". now is the device's
 * clock: a timestamp with an offset in it, alone or next to a localized
 * date, is taken as the instant (a moment can reach the server a while
 * after it was kept); without one the instant is the server's clock.
 */
export function localClock(now: string, timeZone: string | null, serverNow = Date.now()): string {
  const zone = validTimeZone(timeZone);
  const stamp = STAMP.exec(now)?.[0];
  const stated = stamp ? Date.parse(stamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN;
  const at = Number.isFinite(stated) ? stated : serverNow;
  const offset = zone ? zoneOffsetMinutes(zone, at) : Number.isFinite(stated) ? parseOffset(stamp!.match(/(Z|[+-]\d{2}:?\d{2})$/)![1]!) : 0;
  const local = new Date(at + offset * 60_000);
  const weekday = local.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const iso = `${local.toISOString().slice(0, 19)}${formatOffset(offset)}`;
  if (zone) return `${weekday} ${iso} (${zone})`;
  return Number.isFinite(stated) ? `${weekday} ${iso}` : `${weekday} ${iso} (UTC; the wearer's time zone is unknown)`;
}

/**
 * A time the model wrote, held to ISO 8601: a date alone, or a date and
 * time with an offset. A local time without one gets the wearer's offset
 * for that date; anything that is not a real date becomes null.
 */
export function normalizeIsoTime(value: string | null | undefined, timeZone: string | null): string | null {
  const v = value?.trim();
  const m = v ? ISO.exec(v) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", off] = m;
  const day = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (new Date(day).toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return null;
  if (h === undefined) return `${y}-${mo}-${d}`;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (off) return `${local}${off === "Z" ? "Z" : formatOffset(parseOffset(off))}`;
  const zone = validTimeZone(timeZone);
  if (!zone) return local;
  // The offset in force at that wall time; the second pass settles it
  // except within the hour a clock change skips or repeats.
  const wall = day + (Number(h) * 60 + Number(mi)) * 60_000 + Number(s) * 1000;
  let offset = zoneOffsetMinutes(zone, wall);
  offset = zoneOffsetMinutes(zone, wall - offset * 60_000);
  return `${local}${formatOffset(offset)}`;
}

/** When a moment was kept, in the wearer's zone, for a prompt: "Thu 30 Oct 2026, 15:04". The raw value when it does not parse. */
export function describeTime(iso: string, timeZone: string | null): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  const zone = validTimeZone(timeZone);
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone ?? "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return zone ? text : `${text} UTC`;
}
