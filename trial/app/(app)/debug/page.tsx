"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, SectionTitle } from "@/components/ui/Card";
import { fmtMs, ReadoutRows } from "@/components/ui/Readout";
import { TooltipCard, useRowTooltip } from "@/components/charts/Tooltip";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useI18n } from "@/components/providers/AppProviders";
import { api, ApiError } from "@/lib/client/api";
import { cachedProfile } from "@/lib/client/session";
import { useStore } from "@/lib/client/store";
import { mediaKeys } from "@/lib/gestures/media-keys";
import { percentile } from "@/lib/shared/stats";
import { MEDIA_KEY_ACTIONS, type LatencyEvent } from "@/lib/shared/types";

const TARGET_MS = 1500;
const STAGES = ["endpointingMs", "sttFinalMs", "llmFirstTokenMs", "firstSentenceMs", "ttsFirstAudioMs", "playbackStartMs"] as const;
type Stage = (typeof STAGES)[number];

export default function DebugPage() {
  const { m, f, locale } = useI18n();
  const keys = useStore(mediaKeys);
  const [events, setEvents] = useState<LatencyEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { active, bind } = useRowTooltip();

  useEffect(() => {
    api<LatencyEvent[]>("/api/latency?limit=60")
      .then(setEvents)
      .catch((err) => setError(err instanceof ApiError ? err.code : "network"));
  }, []);

  const turns = useMemo(() => (events ?? []).filter((e) => e.kind === "turn").slice(0, 20), [events]);
  const onboarding = useMemo(() => (events ?? []).filter((e) => e.kind === "onboarding"), [events]);
  const stat = (stage: Stage, p: number) =>
    percentile(turns.map((t) => t[stage]).filter((v): v is number => v !== null), p);
  const p50 = stat("playbackStartMs", 50);
  const p95 = stat("playbackStartMs", 95);
  const maxMs = Math.max(TARGET_MS * 1.4, ...turns.map((t) => t.playbackStartMs ?? 0));
  const pct = (ms: number) => `${Math.min(100, (ms / maxMs) * 100)}%`;
  const profile = cachedProfile();
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="mx-auto max-w-[920px] space-y-6">
      <header>
        <h1 className="t-display text-[1.9rem]">{m.debug.title}</h1>
        <p className="mt-2 max-w-2xl text-mist">{m.debug.lead}</p>
      </header>
      {error ? <ErrorCallout code={error} /> : null}

      <Card>
        <p className="text-[0.92rem] text-mist">{m.debug.stages.playbackStartMs}, {m.debug.p50}</p>
        <p className="mt-1 font-display text-[3.4rem] font-medium leading-none tracking-tight">{p50 === null ? "-" : fmtMs(p50)}</p>
        <p className="t-mono mt-3 text-[0.8rem] text-fog">
          {m.debug.p95} {fmtMs(p95)} · {f(m.debug.target, { s: fmtMs(TARGET_MS) })} · {f(m.debug.count, { n: turns.length })}
        </p>
      </Card>

      <Card>
        <SectionTitle title={m.debug.last20} />
        {turns.length === 0 ? (
          <p className="text-mist">{m.debug.none}</p>
        ) : (
          <>
            <div className="relative mb-2 ml-[92px] h-4 sm:ml-[132px]" aria-hidden="true">
              <span className="t-mono absolute -translate-x-1/2 text-[0.7rem] text-paper" style={{ left: pct(TARGET_MS) }}>
                {fmtMs(TARGET_MS)}
              </span>
            </div>
            <ol className="space-y-1.5">
              {turns.map((t) => (
                <li key={t.id} className="relative grid grid-cols-[84px_1fr] items-center gap-2 rounded-[6px] py-1 outline-none focus-visible:bg-well-2 sm:grid-cols-[124px_1fr]" {...bind(t.id)} aria-label={`${time(t.createdAt)} ${fmtMs(t.playbackStartMs)}`}>
                  <span className="t-mono truncate text-[0.72rem] text-fog">
                    {time(t.createdAt)} <span className="hidden sm:inline">{t.inputMode} {t.sttMode}{t.whisper ? " w" : ""}</span>
                  </span>
                  <span className="relative h-[10px]">
                    <span className="absolute inset-y-[-4px] w-px bg-paper/60" style={{ left: pct(TARGET_MS) }} aria-hidden="true" />
                    {t.playbackStartMs !== null ? (
                      <span
                        className={`absolute inset-y-0 left-0 rounded-r-[4px] ${active === t.id ? "bg-paper" : "bg-mist/70"}`}
                        style={{ width: pct(t.playbackStartMs) }}
                      />
                    ) : (
                      <span className="t-mono absolute left-0 top-1/2 -translate-y-1/2 text-[0.7rem] text-fog">{t.errorCode ?? "-"}</span>
                    )}
                  </span>
                  {active === t.id ? (
                    <TooltipCard
                      rows={STAGES.map((s) => ({ label: m.debug.stages[s], value: fmtMs(t[s]) }))}
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle title={`${m.debug.p50} / ${m.debug.p95}`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[0.88rem]">
            <thead>
              <tr className="text-fog">
                <th className="py-2 pr-3 font-normal" />
                <th className="t-mono py-2 pr-3 text-right font-normal">{m.debug.p50}</th>
                <th className="t-mono py-2 text-right font-normal">{m.debug.p95}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {STAGES.map((s) => (
                <tr key={s}>
                  <td className="py-2 pr-3 text-mist">{m.debug.stages[s]}</td>
                  <td className="t-mono py-2 pr-3 text-right">{fmtMs(stat(s, 50))}</td>
                  <td className="t-mono py-2 text-right">{fmtMs(stat(s, 95))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-[0.88rem] text-mist">{m.debug.last20}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="t-mono w-full min-w-[720px] text-left text-[0.75rem]">
              <thead>
                <tr className="text-fog">
                  <th className="py-1.5 pr-2 font-normal" />
                  <th className="py-1.5 pr-2 font-normal">{m.debug.mode}</th>
                  <th className="py-1.5 pr-2 font-normal">{m.debug.sttMode}</th>
                  {STAGES.map((s) => (
                    <th key={s} className="py-1.5 pr-2 text-right font-normal">{m.debug.stages[s]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {turns.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5 pr-2 text-fog">{time(t.createdAt)}</td>
                    <td className="py-1.5 pr-2">{t.inputMode}{t.whisper ? " +w" : ""}{t.bargeIn ? " +b" : ""}</td>
                    <td className="py-1.5 pr-2">{t.sttMode ?? "-"}</td>
                    {STAGES.map((s) => (
                      <td key={s} className="py-1.5 pr-2 text-right">{fmtMs(t[s])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      {onboarding.length ? (
        <Card>
          <SectionTitle title={m.debug.onboarding} />
          <ReadoutRows rows={onboarding.slice(0, 5).map((o) => ({ label: time(o.createdAt), value: fmtMs(o.sinceLandingMs) }))} />
        </Card>
      ) : null}

      <Card>
        <SectionTitle title={m.debug.device} />
        <ReadoutRows
          rows={[
            { label: m.setup.mic.device, value: profile?.inputLabel || "-" },
            { label: m.setup.mic.trackRate, value: profile?.trackSampleRate ? `${profile.trackSampleRate} Hz` : m.common.notReported },
            { label: m.setup.mic.contextRate, value: profile?.contextSampleRate ? `${profile.contextSampleRate} Hz` : "-" },
            { label: m.setup.mic.channels, value: profile?.channelCount ?? "-" },
            { label: m.setup.mic.bandwidth, value: profile?.effectiveBandwidthHz ? `${profile.effectiveBandwidthHz} Hz` : "-" },
            { label: "Browser", value: `${profile?.browser ?? "-"} / ${profile?.os ?? "-"}` },
            ...MEDIA_KEY_ACTIONS.map((a) => ({
              label: m.gestures.actions[a],
              value: keys.status[a].fired ? f(m.gestures.received, { n: keys.status[a].fired }) : keys.enabled ? m.gestures.notYet : "-",
            })),
          ]}
        />
      </Card>
    </div>
  );
}
