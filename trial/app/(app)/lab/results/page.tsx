"use client";

import { useEffect, useMemo, useState } from "react";
import { GroupPanel } from "@/components/lab/GroupPanel";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, Card } from "@/components/ui/Card";
import { fmtPct } from "@/components/ui/Readout";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useConfig, useI18n } from "@/components/providers/AppProviders";
import { api, ApiError } from "@/lib/client/api";
import { download } from "@/lib/client/download";
import { PROVIDER_NAMES } from "@/lib/client/platform";
import { dashboard } from "@/lib/shared/lab/aggregate";
import type { ChainId, Environment, LabResult, VoiceStyle } from "@/lib/shared/types";

export default function LabResultsPage() {
  const { m, f } = useI18n();
  const config = useConfig();
  const [rows, setRows] = useState<LabResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LabResult[]>("/api/lab/results")
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.code : "network"));
  }, []);

  // On a deployment with only the mock recognizer, show its results, clearly
  // labelled as simulated; otherwise mock rows never reach the numbers.
  const mockOnly = config.labSttProviders.every((p) => p === "mock");
  const d = useMemo(() => (rows ? dashboard(rows, mockOnly) : null), [rows, mockOnly]);

  const conditionLabel = (k: string) => {
    const [v, e] = k.split("|") as [VoiceStyle, Environment];
    return `${m.lab.voices[v]}, ${m.lab.environments[e]}`;
  };
  const providerLabel = (k: string) => {
    const [p, model] = k.split("|");
    return `${PROVIDER_NAMES[p!] ?? p} ${model ?? ""}`.trim();
  };
  const all = d ? [...d.byCondition, ...d.byDevice, ...d.byChain, ...d.byProvider] : [];
  const top = Math.max(0.2, ...all.map((g) => g.wer.hi ?? g.wer.rate ?? 0));
  const axisMax = Math.ceil(top * 10) / 10;

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="t-label">{m.results.scope}</p>
          <h1 className="t-display mt-1 text-[1.9rem]">{m.results.title}</h1>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/lab" variant="ghost" icon="back">
            {m.lab.title}
          </ButtonLink>
          <Button icon="download" disabled={!rows?.length} onClick={() => void download("/api/lab/results?format=csv", "lab.csv").catch(() => setError("network"))}>
            {m.results.exportCsv}
          </Button>
        </div>
      </header>

      {error ? <ErrorCallout code={error} /> : null}
      {mockOnly && rows?.length ? <Callout kind="warn" title={m.lab.simulated} /> : null}

      {d ? (
        <>
          <Card>
            <p className="text-[0.95rem] text-mist">{m.results.headline}</p>
            {d.headline ? (
              <>
                <p className="mt-2 font-display text-[3.6rem] font-medium leading-none tracking-tight">{fmtPct(d.headline.stat.wer.rate)}</p>
                <p className="t-mono mt-3 text-[0.82rem] text-mist">
                  {m.results.wer} · {m.results.ci}{" "}
                  {d.headline.stat.wer.lo !== null ? f(m.results.range, { lo: fmtPct(d.headline.stat.wer.lo), hi: fmtPct(d.headline.stat.wer.hi) }) : "-"}
                </p>
                <p className="mt-1 text-[0.92rem] text-paper">
                  {f(m.results.headlineDetail, {
                    chain: m.lab.chainNames[d.headline.chain as ChainId],
                    provider: d.headline.bestProvider ? providerLabel(d.headline.bestProvider.key) : "-",
                    n: d.headline.stat.wer.n,
                  })}
                </p>
              </>
            ) : (
              <p className="mt-2 max-w-xl text-[1.05rem]">{m.results.headlineNone}</p>
            )}
          </Card>

          {d.usable.length === 0 ? (
            <p className="text-mist">{m.results.empty}</p>
          ) : (
            <div className="grid gap-4">
              <GroupPanel title={m.results.byCondition} groups={d.byCondition} labelOf={conditionLabel} axisMax={axisMax} />
              <GroupPanel title={m.results.byChain} groups={d.byChain} labelOf={(k) => m.lab.chainNames[k as ChainId]} axisMax={axisMax} />
              <GroupPanel title={m.results.byProvider} groups={d.byProvider} labelOf={providerLabel} axisMax={axisMax} />
              <GroupPanel title={m.results.byDevice} groups={d.byDevice} labelOf={(k) => k} axisMax={axisMax} />
            </div>
          )}

          {!mockOnly && d.mock ? <p className="text-[0.88rem] text-fog">{m.results.mockWarning}</p> : null}
          {d.failed ? <p className="text-[0.88rem] text-fog">{f(m.results.failures, { n: d.failed })}</p> : null}
          <p className="max-w-3xl text-[0.88rem] leading-relaxed text-fog">{m.results.explain}</p>
        </>
      ) : null}
    </div>
  );
}
