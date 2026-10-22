import { en, type Messages } from "./messages/en";
import { tr } from "./messages/tr";

export type Locale = "en" | "tr";
export const LOCALES: readonly Locale[] = ["en", "tr"];
export const LOCALE_COOKIE = "sl_lang";
export type { Messages };

const dictionaries: Record<Locale, Messages> = { en, tr };

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "tr";
}

/** Picks Turkish if the browser prefers it over English, else English. */
export function negotiate(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return "en";
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: (tag ?? "").toLowerCase().slice(0, 2), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.lang === "tr" || x.lang === "en")
    .sort((a, b) => b.q - a.q);
  return ranked[0]?.lang === "tr" ? "tr" : "en";
}

/**
 * Replaces {name} placeholders. Unknown placeholders are left visible.
 * {s} is filled from {n} for English plurals ("{n} note{s}"); Turkish keeps
 * the singular after numerals, so its strings simply do not use it.
 */
export function format(template: string, vars: Record<string, string | number> = {}): string {
  const all = "n" in vars && !("s" in vars) ? { ...vars, s: Number(vars.n) === 1 ? "" : "s" } : vars;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in all ? String(all[k]) : m));
}
