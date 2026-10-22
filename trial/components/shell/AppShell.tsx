"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { Callout } from "@/components/ui/Card";
import { api, onConsentLost } from "@/lib/client/api";
import { assistant } from "@/lib/client/assistant";
import { currentToken } from "@/lib/client/auth";
import { startCommandRouting } from "@/lib/client/commands";
import { micManager } from "@/lib/client/mic-manager";
// Registers the recorder's controls for the banner and earbud gestures.
import "@/lib/client/recorder";
import { recorderControls } from "@/lib/client/recorder-controls";
import { rewind } from "@/lib/client/rewind";
import { getPrefs, setPrefs } from "@/lib/client/prefs";
import { ensureSession, forgetSession } from "@/lib/client/session";
import { startKeyboardGestures } from "@/lib/gestures/keyboard";
import type { ConsentKind, ConsentRecord } from "@/lib/shared/types";
import { AudioResume } from "./AudioResume";
import { BottomNav } from "./BottomNav";
import { RecordingBanner } from "./RecordingBanner";
import { StatusStrip } from "./StatusStrip";

/**
 * Frame for every screen after consent. Sends visitors without a current
 * consent back to the consent screen (checked with the server, not only the
 * browser), makes sure this visit has a session, and hosts the parts that
 * must survive navigation: the status strip, the recording banner, and the
 * keyboard gesture source.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { m, locale } = useI18n();
  const config = useConfig();
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);

  // The server no longer has this browser's agreement. Stop every capture,
  // drop this visit's session (the server lost it too) and ask again; the
  // device settings stay.
  const consentLost = useCallback(() => {
    recorderControls.stop();
    rewind.disable();
    assistant.deactivate();
    micManager.close();
    assistant.clear();
    forgetSession({ keepProfileCache: true });
    setPrefs({ consentVersion: undefined });
    router.replace("/consent?reset=1");
  }, [router]);

  useEffect(() => {
    onConsentLost(consentLost);
    return () => onConsentLost(null);
  }, [consentLost]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await currentToken();
      if (!token || getPrefs().consentVersion !== config.consentVersion) {
        router.replace(token ? "/consent" : "/");
        return;
      }
      // The browser's copy is not enough: without a database the server
      // keeps agreements in memory and forgets them when it restarts.
      try {
        const { terms } = await api<Partial<Record<ConsentKind, ConsentRecord>>>("/api/consent");
        if (!terms?.granted || terms.version !== config.consentVersion) {
          if (!cancelled) consentLost();
          return;
        }
      } catch {
        // Unreachable or signed out: the session step below reports it.
      }
      try {
        await ensureSession(locale);
      } catch {
        if (!cancelled) setSessionError(true);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [config.consentVersion, consentLost, locale, router]);

  useEffect(() => startKeyboardGestures(), []);
  useEffect(() => startCommandRouting(), []);
  useEffect(() => assistant.configure(config), [config]);

  const inSetup = path.startsWith("/setup");

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-paper focus:px-4 focus:py-2 focus:text-ink">
        {m.common.skipToContent}
      </a>
      <StatusStrip />
      <AudioResume />
      <RecordingBanner />
      <main id="main" className={`relative z-10 mx-auto w-full max-w-[1180px] px-4 pt-6 sm:px-6 ${inSetup ? "pb-16" : "pb-nav"}`}>
        {config.problems.length && process.env.NODE_ENV === "production" ? (
          <div className="mb-6">
            <Callout kind="error" title={m.errors.server_not_configured.title}>
              {m.errors.server_not_configured.action}
            </Callout>
          </div>
        ) : null}
        {sessionError ? (
          <div className="mb-6">
            <Callout kind="error" title={m.errors.network.title}>
              {m.errors.network.action}
            </Callout>
          </div>
        ) : null}
        {ready ? children : null}
      </main>
      {inSetup ? null : <BottomNav />}
    </>
  );
}
