"use client";

import { useEffect } from "react";
import { Button, ButtonLink, Spinner } from "@/components/ui/Button";
import { Callout, Card } from "@/components/ui/Card";
import { fmtPct } from "@/components/ui/Readout";
import { ErrorCallout } from "@/components/ErrorCallout";
import { useI18n } from "@/components/providers/AppProviders";
import { lab } from "@/lib/client/lab";
import { PROVIDER_NAMES } from "@/lib/client/platform";
import { useStore } from "@/lib/client/store";
import { CHAINS } from "@/lib/shared/types";

export function LabRunner() {
  const { m, f } = useI18n();
  const v = useStore(lab.view);
  const phrase = v.phrases[v.index];
  const take = phrase ? v.takes[phrase.id] : undefined;
  const run = v.run;
  const recording = v.stage === "recording";
  const scored = Object.values(v.takes).filter((t) => t.status === "scored").length;

  // Space starts and stops a take.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || (e.target as HTMLElement)?.tagName === "BUTTON") return;
      e.preventDefault();
      if (lab.view.get().stage === "recording") void lab.stopTake();
      else lab.startTake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (v.stage === "done") {
    return (
      <Card>
        <h2 className="text-[1.35rem]">{f(m.lab.runDone, { n: scored })}</h2>
        {v.pending ? <p className="mt-2 text-mist">{f(m.lab.stillScoring, { n: v.pending })}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink href="/lab/results" variant="primary" icon="chart">
            {m.lab.viewResults}
          </ButtonLink>
          <Button variant="ghost" onClick={() => lab.reset()}>
            {m.lab.begin}
          </Button>
        </div>
      </Card>
    );
  }
  if (!phrase || !run) return null;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="t-label">{f(m.lab.phraseOf, { n: v.index + 1, total: v.phrases.length })}</p>
          <p className="t-label">{m.lab.voices[run.voiceStyle]}</p>
          <p className="t-label">{m.lab.environments[run.environment]}</p>
          {v.pending ? <p className="t-label ml-auto">{f(m.lab.stillScoring, { n: v.pending })}</p> : null}
        </div>
        <div className="mt-2 h-[3px] rounded-full bg-[var(--hairline)]">
          <div className="h-full rounded-full bg-paper/70 transition-[width]" style={{ width: `${(v.index / v.phrases.length) * 100}%` }} />
        </div>

        <p className="mt-8 text-[0.95rem] text-mist">{run.voiceStyle === "whisper" ? m.lab.whisperThis : m.lab.readAloud}</p>
        <p lang={phrase.lang} className="t-display mt-3 text-[clamp(1.7rem,5vw,2.6rem)] leading-tight">
          {phrase.text}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {recording ? (
            <Button variant="primary" size="lg" icon="stop" onClick={() => void lab.stopTake()}>
              <span className="rec-dot" aria-hidden="true" />
              {f(m.lab.recordingFor, { s: Math.floor(v.elapsedMs / 1000) })}
            </Button>
          ) : (
            <Button variant="primary" size="lg" icon="mic" onClick={() => lab.startTake()}>
              {take ? m.lab.redo : m.lab.record}
            </Button>
          )}
          {!recording && take ? (
            <Button size="lg" iconRight="arrow" onClick={() => lab.next()}>
              {v.index + 1 >= v.phrases.length ? m.lab.finish : m.lab.next}
            </Button>
          ) : null}
          {!recording && v.index > 0 ? (
            <Button variant="ghost" icon="back" onClick={() => lab.previous()}>
              {m.lab.previous}
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-[0.85rem] text-fog">{v.vad === "ready" ? m.lab.autoStop : v.vad === "loading" ? m.recorder.vadLoading : null}</p>
        {v.dual ? <p className="mt-1 text-[0.85rem] text-fog">{m.lab.dualOn}</p> : v.dual === false && run.chains.length < CHAINS.length ? <p className="mt-1 text-[0.85rem] text-fog">{m.lab.dualUnavailable}</p> : null}
      </Card>

      {take ? (
        <Card aria-label={m.lab.takeScores}>
          {take.status === "processing" ? (
            <p className="flex items-center gap-2 text-mist">
              <Spinner /> {m.lab.scoring}
            </p>
          ) : take.status === "silent" ? (
            <Callout kind="warn" title={m.lab.silent} />
          ) : take.status === "too_long" ? (
            <Callout kind="warn" title={m.lab.tooLong} />
          ) : take.status === "error" ? (
            <ErrorCallout code={take.error ?? "generic"} />
          ) : (
            <TakeTable />
          )}
        </Card>
      ) : null}

      <div>
        <Button variant="ghost" onClick={() => void lab.finish()}>
          {m.lab.abort}
        </Button>
      </div>
    </div>
  );

  function TakeTable() {
    const rows = take!.rows;
    return (
      <div className="overflow-x-auto">
        <p className="t-label mb-2">{m.lab.takeScores}</p>
        <table className="w-full min-w-[480px] text-left text-[0.88rem]">
          <thead>
            <tr className="text-fog">
              <th className="py-2 pr-3 font-normal">{m.lab.chains}</th>
              <th className="py-2 pr-3 font-normal">{m.lab.recognizers}</th>
              <th className="t-mono py-2 pr-3 text-right font-normal">{m.results.wer}</th>
              <th className="py-2 font-normal">{m.lab.heard}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--hairline)]">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-3 text-mist">{m.lab.chainNames[r.chain]}</td>
                <td className="py-2 pr-3">{PROVIDER_NAMES[r.provider] ?? r.provider}</td>
                <td className="t-mono py-2 pr-3 text-right">{r.error ? "-" : fmtPct(r.wer, 0)}</td>
                <td lang={r.language} className="py-2 text-mist">{r.error ? <span className="t-mono text-[0.75rem]">{r.error}</span> : r.hypothesis || "..."}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}
