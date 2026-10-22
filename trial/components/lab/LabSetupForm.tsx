"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, Card } from "@/components/ui/Card";
import { Checkbox, Field, Segmented, Select } from "@/components/ui/Controls";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { lab, type LabSetup } from "@/lib/client/lab";
import { PROVIDER_NAMES } from "@/lib/client/platform";
import { getPrefs } from "@/lib/client/prefs";
import { cachedProfile } from "@/lib/client/session";
import { useStore } from "@/lib/client/store";
import { CHAINS, ENVIRONMENTS, type ChainId, type Environment, type Lang, type SttProviderId, type VoiceStyle } from "@/lib/shared/types";

export function LabSetupForm() {
  const { m, f, locale } = useI18n();
  const config = useConfig();
  const v = useStore(lab.view);
  const profile = cachedProfile();
  const [setup, setSetup] = useState<LabSetup>(() => ({
    language: getPrefs().labLanguage ?? locale,
    voiceStyle: "whisper",
    environment: "quiet_room",
    chains: [...CHAINS],
    providers: [...config.labSttProviders],
    count: 10,
    storeAudio: false,
  }));
  const set = (patch: Partial<LabSetup>) => setSetup((s) => ({ ...s, ...patch }));
  const toggle = <T,>(list: T[], item: T, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-[1.25rem]">{m.lab.conditions}</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label={m.lab.language}>
            <Segmented<Lang>
              label={m.lab.language}
              value={setup.language}
              onChange={(language) => set({ language })}
              options={[
                { value: "en", label: "English" },
                { value: "tr", label: "Türkçe" },
              ]}
            />
          </Field>
          <Field label={m.lab.voice}>
            <Segmented<VoiceStyle>
              label={m.lab.voice}
              value={setup.voiceStyle}
              onChange={(voiceStyle) => set({ voiceStyle })}
              options={[
                { value: "normal", label: m.lab.voices.normal },
                { value: "whisper", label: m.lab.voices.whisper },
              ]}
            />
          </Field>
          <Field label={m.lab.environment}>
            <Select
              label={m.lab.environment}
              value={setup.environment}
              onChange={(e) => set({ environment: e as Environment })}
              options={ENVIRONMENTS.map((e) => ({ value: e, label: m.lab.environments[e] }))}
            />
          </Field>
          <Field label={m.lab.count}>
            <Segmented<"10" | "30">
              label={m.lab.count}
              value={String(setup.count) as "10" | "30"}
              onChange={(c) => set({ count: c === "10" ? 10 : 30 })}
              options={[
                { value: "10", label: m.lab.quick },
                { value: "30", label: m.lab.full },
              ]}
            />
          </Field>
        </div>

        <div className="mt-6">
          <Field label={m.lab.device}>
            {profile?.inputLabel ? (
              <p className="min-h-12 rounded-[12px] border border-[var(--hairline)] px-4 py-3">{profile.inputLabel}</p>
            ) : (
              <Callout kind="warn" title={m.lab.deviceMissing} action={<ButtonLink href="/setup">{m.settings.rerunSetup}</ButtonLink>} />
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-[1.25rem]">{m.lab.chains}</h2>
        <div className="mt-3 space-y-1">
          {CHAINS.map((c: ChainId) => (
            <Checkbox key={c} checked={setup.chains.includes(c)} onChange={(on) => set({ chains: toggle(setup.chains, c, on) })}>
              <span className="font-medium">{m.lab.chainNames[c]}</span>
              <span className="block text-[0.86rem] text-mist">{m.lab.chainHints[c]}</span>
            </Checkbox>
          ))}
        </div>
        {v.dual === false ? <p className="mt-3 text-[0.86rem] text-fog">{m.lab.dualUnavailable}</p> : null}
        <p className="mt-3 text-[0.86rem] text-fog">{m.lab.rawNote}</p>

        <h2 className="mt-6 text-[1.25rem]">{m.lab.recognizers}</h2>
        {config.labSttProviders.length ? (
          <div className="mt-3 space-y-1">
            {config.labSttProviders.map((p: SttProviderId) => (
              <Checkbox key={p} checked={setup.providers.includes(p)} onChange={(on) => set({ providers: toggle(setup.providers, p, on) })}>
                {PROVIDER_NAMES[p] ?? p}
              </Checkbox>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-mist">{m.lab.noRecognizers}</p>
        )}
        {config.labSttProviders.includes("mock") ? <p className="mt-3 text-[0.86rem] text-fog">{m.lab.simulated}</p> : null}
      </Card>

      <Card>
        <Checkbox checked={setup.storeAudio} onChange={(storeAudio) => set({ storeAudio })}>
          <span className="font-medium">{m.lab.storeAudio}</span>
          <span className="block text-[0.86rem] text-mist">{f(m.lab.storeAudioHint, { days: config.labAudioRetentionDays })}</span>
        </Checkbox>
      </Card>

      {v.error ? <ErrorCallout code={v.error} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          iconRight="arrow"
          busy={v.stage === "starting"}
          disabled={!setup.chains.length || !setup.providers.length}
          onClick={() => void lab.startRun(setup)}
        >
          {m.lab.begin}
        </Button>
        <ButtonLink href="/lab/results" variant="ghost" icon="chart">
          {m.lab.pastResults}
        </ButtonLink>
      </div>
    </div>
  );
}
