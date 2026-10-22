"use client";

import { useI18n } from "@/components/providers/AppProviders";
import { LOCALES } from "@/lib/i18n";

export function LanguageSwitch() {
  const { locale, setLocale, m } = useI18n();
  return (
    <div className="flex items-center gap-1 rounded-full border border-[var(--hairline)] p-1" role="group" aria-label="Language">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
          className={`t-mono min-h-9 min-w-11 rounded-full px-3 text-[0.75rem] uppercase tracking-wider transition-colors ${
            locale === l ? "bg-paper text-ink" : "text-mist hover:text-paper"
          }`}
          title={m.common.languages[l]}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
