"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Controls";
import { ErrorCallout } from "@/components/ErrorCallout";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { api, ApiError } from "@/lib/client/api";
import { AuthError, startTrialIdentity } from "@/lib/client/auth";
import { PROVIDER_NAMES } from "@/lib/client/platform";
import { getPrefs, setPrefs } from "@/lib/client/prefs";
import { ensureSession } from "@/lib/client/session";

/**
 * First run consent. Nothing is pre-ticked, and no identity, session or
 * microphone access exists until the visitor ticks the box and presses Start.
 * Provider names come from the server's live configuration, so the text
 * always names who actually receives the data on this deployment.
 */
export function ConsentForm({ reset = false }: { reset?: boolean }) {
  const { m, f, locale } = useI18n();
  const config = useConfig();
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = (id: string) => PROVIDER_NAMES[id] ?? id;
  const allMock = config.mockProviders.length > 0 && config.llm.provider === "mock" && config.stt.provider === "mock";
  const outdated = !!getPrefs().consentVersion && getPrefs().consentVersion !== config.consentVersion;

  const sections: { icon: IconName; title: string; body: React.ReactNode }[] = [
    { icon: "mic", title: m.consent.micTitle, body: m.consent.micBody },
    {
      icon: "arrow",
      title: m.consent.sentTitle,
      body: allMock ? (
        m.consent.sentMock
      ) : (
        <ul className="list-none space-y-1.5">
          <li>{f(m.consent.sentStt, { stt: name(config.stt.provider) })}</li>
          <li>{f(m.consent.sentLlm, { llm: name(config.llm.provider) })}</li>
          <li>{f(m.consent.sentTts, { tts: name(config.tts.provider) })}</li>
          <li>{f(m.consent.sentEmbed, { embed: name(config.embeddings.provider) })}</li>
          <li>{f(m.consent.sentLab, { lab: config.labSttProviders.map(name).join(", ") })}</li>
        </ul>
      ),
    },
    {
      icon: "lock",
      title: m.consent.storedTitle,
      body: f(m.consent.storedBody, { rawDays: config.rawAudioRetentionDays, labDays: config.labAudioRetentionDays }),
    },
    { icon: "info", title: m.consent.howLongTitle, body: m.consent.howLongBody },
    { icon: "trash", title: m.consent.deleteTitle, body: m.consent.deleteBody },
    { icon: "flag", title: m.consent.othersTitle, body: m.consent.othersBody },
    { icon: "info", title: m.consent.medicalTitle, body: m.consent.medicalBody },
  ];

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await startTrialIdentity();
      await api("/api/consent", { method: "POST", json: { kind: "terms", version: config.consentVersion, granted: true } });
      setPrefs({ speechLang: getPrefs().speechLang ?? locale });
      await ensureSession(locale);
      setPrefs({ consentVersion: config.consentVersion });
      router.push(getPrefs().setupDone ? "/assistant" : "/setup");
    } catch (err) {
      setError(err instanceof AuthError || err instanceof ApiError ? err.code : "generic");
      setBusy(false);
    }
  }

  return (
    <main className="relative z-10 mx-auto max-w-[760px] px-5 pb-16 pt-[max(20px,env(safe-area-inset-top))] sm:px-8">
      <header className="flex items-center justify-between py-3">
        <Image src="/brand/wordmark-light.png" alt="Signalive" width={130} height={11} className="h-auto w-[120px]" />
        <LanguageSwitch />
      </header>

      <h1 className="t-display rise mt-8 text-[clamp(2.1rem,6vw,3.2rem)]">{m.consent.title}</h1>
      <p className="rise rise-1 mt-3 text-[1.05rem] text-mist">{m.consent.lead}</p>
      {reset ? (
        <p className="rise rise-1 mt-4 text-[0.95rem] text-paper">
          {config.dataStore === "memory" ? m.consent.resetMemory : m.consent.reset}
        </p>
      ) : outdated ? (
        <p className="rise rise-1 mt-4 text-[0.95rem] text-paper">{m.consent.updated}</p>
      ) : null}

      <div className="rise rise-2 mt-8 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
        {sections.map((s) => (
          <section key={s.title} className="grid grid-cols-[28px_1fr] gap-x-3 py-5">
            <Icon name={s.icon} size={20} className="mt-0.5 text-fog" />
            <div>
              <h2 className="text-[1.05rem] font-medium">{s.title}</h2>
              <div className="mt-1.5 text-[0.95rem] leading-relaxed text-mist">{s.body}</div>
            </div>
          </section>
        ))}
      </div>

      <div className="rise rise-3 mt-8 space-y-5">
        <Checkbox checked={agreed} onChange={setAgreed}>
          {m.consent.agree}
        </Checkbox>
        {error ? <ErrorCallout code={error} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" iconRight="arrow" disabled={!agreed} busy={busy} onClick={start}>
            {busy ? m.consent.starting : m.consent.start}
          </Button>
          <ButtonLink href="/" variant="ghost">
            {m.consent.notNow}
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
