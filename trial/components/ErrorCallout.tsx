"use client";

import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Card";
import { useI18n } from "@/components/providers/AppProviders";
import { errorKey } from "@/lib/client/api";
import { detectPlatform } from "@/lib/client/platform";

const MIC_CODES = ["mic_denied", "mic_not_found", "mic_in_use", "mic_insecure", "audio_unsupported", "vad_failed", "playback_blocked"] as const;
type MicCode = (typeof MIC_CODES)[number];

/** Turns any error code into a translated explanation plus the next action. */
export function ErrorCallout({ code, action }: { code: string; action?: ReactNode }) {
  const { m } = useI18n();
  if ((MIC_CODES as readonly string[]).includes(code)) {
    const c = code as MicCode;
    let help: string = m.errors[c].action;
    if (c === "mic_denied") {
      const p = detectPlatform();
      help = p.isIOS ? m.errors.mic_denied_ios : p.isAndroid ? m.errors.mic_denied_android : m.errors.mic_denied_chrome;
    }
    return (
      <Callout kind="error" title={m.errors[c].title} action={action}>
        {help}
      </Callout>
    );
  }
  const key = errorKey(code);
  // "Start again from the first page" comes with the way there.
  const fallback = key === "unauthenticated" ? <ButtonLink href="/">{m.common.startAgain}</ButtonLink> : undefined;
  return (
    <Callout kind="error" title={m.errors[key].title} action={action ?? fallback}>
      {m.errors[key].action}
    </Callout>
  );
}
