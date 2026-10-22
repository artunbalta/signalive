"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format, LOCALE_COOKIE, type Locale, type Messages } from "@/lib/i18n";
import { initAuth } from "@/lib/client/auth";
import { setFormatLocale } from "@/components/ui/Readout";
import type { PublicConfig } from "@/lib/shared/types";

export type ClientConfig = PublicConfig & { problems: string[] };

interface I18nValue {
  locale: Locale;
  m: Messages;
  f: typeof format;
  setLocale: (l: Locale) => void;
}

const I18nCtx = createContext<I18nValue | null>(null);
const ConfigCtx = createContext<ClientConfig | null>(null);

export function AppProviders({
  locale,
  messages,
  config,
  children,
}: {
  locale: Locale;
  messages: Messages;
  config: ClientConfig;
  children: ReactNode;
}) {
  const router = useRouter();
  // Synchronous on purpose: API calls made by children's effects need it.
  initAuth(config);
  setFormatLocale(locale);

  const setLocale = useCallback(
    (l: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    },
    [router],
  );

  const i18n = useMemo(() => ({ locale, m: messages, f: format, setLocale }), [locale, messages, setLocale]);

  return (
    <ConfigCtx.Provider value={config}>
      <I18nCtx.Provider value={i18n}>{children}</I18nCtx.Provider>
    </ConfigCtx.Provider>
  );
}

export function useI18n(): I18nValue {
  const v = useContext(I18nCtx);
  if (!v) throw new Error("useI18n outside AppProviders");
  return v;
}

export function useConfig(): ClientConfig {
  const v = useContext(ConfigCtx);
  if (!v) throw new Error("useConfig outside AppProviders");
  return v;
}
