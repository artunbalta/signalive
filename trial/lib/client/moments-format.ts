import type { Locale } from "@/lib/i18n";
import type { Moment } from "@/lib/shared/moments";

/**
 * How moments read: times, days and due dates in the interface language, and
 * the plain text a moment is shared as. Pure, so the feed, the detail, the
 * exports and the tests all agree.
 */

const tag = (locale: Locale) => (locale === "tr" ? "tr-TR" : "en-GB");

/** "14:32". */
export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(tag(locale), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** The local calendar day of a moment, "2026-11-02", for grouping. */
export function dayKey(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday", or "Monday 2 November" (and the year, when it is not this one). */
export function formatDay(iso: string, locale: Locale, now: Date, labels: { today: string; yesterday: string }): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return labels.today;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return labels.yesterday;
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(d);
}

/** "14:32" today, else "2 Nov, 14:32" (with the year when it is not this one). */
export function shortWhen(iso: string, locale: Locale, now: Date = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return formatTime(iso, locale);
  return new Intl.DateTimeFormat(tag(locale), {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "Mon 2 Nov 2026, 14:32". */
export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * A due date as the model wrote it: ISO 8601, a date ("2026-11-06", read as
 * that day here) or a date and time (with or without an offset). Null when
 * there is none or it does not parse.
 */
export function parseDue(due: string | null | undefined): { at: Date; allDay: boolean } | null {
  if (!due) return null;
  const s = due.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const [y, mo, d] = [Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])];
    const at = new Date(y, mo, d);
    // Date rolls "2026-13-45" over into another day; such a date was never meant.
    return at.getFullYear() === y && at.getMonth() === mo && at.getDate() === d ? { at, allDay: true } : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : { at: new Date(t), allDay: false };
}

/** "Fri 6 Nov, 15:00", or "Fri 6 Nov" for a whole day; null when there is no usable date. */
export function formatDue(due: string | null | undefined, locale: Locale, now: Date = new Date()): string | null {
  const p = parseDue(due);
  if (!p) return null;
  const sameYear = p.at.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(p.allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(p.at);
}

/**
 * What the model is told the time is: the wearer's own words for it, with
 * the exact moment and offset in brackets so "tomorrow at three" becomes a
 * correct ISO due date. At most 80 characters, as the contract allows.
 */
export function nowForModel(locale: Locale, now: Date = new Date()): string {
  const human = now.toLocaleString(tag(locale), { dateStyle: "full", timeStyle: "short" });
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  const iso = `${dayKey(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}${sign}${hh}:${mm}`;
  return `${human} (${iso})`.slice(0, 80);
}

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** "14:32 · Moda, Kadıköy": when and where, the line every card starts with. */
export function whenWhere(m: Pick<Moment, "createdAt" | "place">, locale: Locale): string {
  const time = formatTime(m.createdAt, locale);
  return m.place?.name ? `${time} · ${m.place.name}` : time;
}

export interface ShareLabels {
  keyPoints: string;
  actionItems: string;
  footer: string;
}

/**
 * A moment as plain text for the share sheet: title, when and where, the
 * summary, the key points and what to do. What was said stays out: it holds
 * other people's words, and sharing it should be a choice made elsewhere.
 */
export function momentShareText(m: Moment, locale: Locale, labels: ShareLabels): string {
  const lines = [m.title, `${formatDateTime(m.createdAt, locale)}${m.place?.name ? ` · ${m.place.name}` : ""}`, "", m.summary];
  if (m.keyPoints.length) lines.push("", `${labels.keyPoints}:`, ...m.keyPoints.map((p) => `- ${p}`));
  if (m.actionItems.length) {
    lines.push(
      "",
      `${labels.actionItems}:`,
      ...m.actionItems.map((a) => {
        const due = formatDue(a.due, locale);
        return `- ${a.text}${due ? ` (${due})` : ""}`;
      }),
    );
  }
  lines.push("", labels.footer);
  return lines.join("\n");
}
