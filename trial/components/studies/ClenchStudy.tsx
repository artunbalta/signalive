"use client";

import { useEffect } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, Card, SectionTitle } from "@/components/ui/Card";
import { Checkbox, Field, Segmented } from "@/components/ui/Controls";
import { fmtPct } from "@/components/ui/Readout";
import { earbuds } from "@/lib/client/earbuds";
import { useStore } from "@/lib/client/store";
import { CLENCH_KINDS, STUDY_CONDITIONS, type ClenchKind, type KindScore } from "@/lib/client/studies/clench-study";
import { FULL_STUDY, QUICK_STUDY, clenchStudy } from "@/lib/client/studies/clench-runner";

/**
 * The clench study's three screens: set it up on the connected earbuds, run
 * it (the cue, the condition, how far along), and its result against the
 * bars, with the files to take away.
 */
export function ClenchStudy() {
  const v = useStore(clenchStudy.view);
  // Leaving the screen ends a running study rather than leave it prompting in the background.
  useEffect(() => () => clenchStudy.stop(), []);
  if (v.stage === "running") return <Running />;
  if (v.stage === "done") return <Result />;
  return <Setup />;
}

function Setup() {
  const { m } = useI18n();
  const t = m.studies.clench;
  const v = useStore(clenchStudy.view);
  const e = useStore(earbuds.view);
  const connected = e.phase === "connected";
  const simulated = e.transport === "simulated";
  const quick = v.settings.perKind === QUICK_STUDY.perKind;

  return (
    <div className="space-y-5">
      {!connected ? (
        <Callout
          kind="info"
          title={t.connectFirst}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="earbud" onClick={() => void earbuds.connect("simulated")} busy={e.phase === "connecting"}>
                {t.useSimulated}
              </Button>
              <ButtonLink href="/earbuds" variant="ghost">
                {t.goEarbuds}
              </ButtonLink>
            </div>
          }
        >
          {t.connectBody}
        </Callout>
      ) : !e.listening ? (
        <Callout kind="info" title={t.learning} />
      ) : null}

      <Card>
        <SectionTitle eyebrow={m.studies.eyebrow} title={t.title} />
        <p className="max-w-[60ch] leading-relaxed text-mist">{t.summary}</p>
        <p className="mt-2 text-[0.92rem] text-fog">{t.bars}</p>

        <div className="mt-6 grid gap-5">
          <Field label={t.participant} hint={t.participantHint}>
            <input
              aria-label={t.participant}
              value={v.settings.participant}
              onChange={(ev) => clenchStudy.configure({ participant: ev.target.value.slice(0, 24) })}
              placeholder="P01"
              autoComplete="off"
              spellCheck={false}
              className="min-h-12 w-full max-w-[16rem] rounded-[12px] border border-[var(--hairline-strong)] bg-ink px-4 font-mono text-paper outline-none focus:border-signal"
            />
          </Field>
          <Field label={t.length}>
            <Segmented
              label={t.length}
              value={quick ? "quick" : "full"}
              options={[
                { value: "full", label: t.full },
                { value: "quick", label: t.quick },
              ]}
              onChange={(val) => clenchStudy.configure(val === "quick" ? QUICK_STUDY : FULL_STUDY)}
            />
          </Field>
          <Checkbox checked={v.settings.simulate && simulated} disabled={!simulated} onChange={(on) => clenchStudy.configure({ simulate: on })}>
            {t.simulate}
            <span className="mt-1 block text-[0.85rem] text-fog">{t.simulateHint}</span>
          </Checkbox>
          <Checkbox checked={v.settings.record} onChange={(on) => clenchStudy.configure({ record: on })}>
            {t.record}
            <span className="mt-1 block text-[0.85rem] text-fog">{t.recordHint}</span>
          </Checkbox>
        </div>

        {v.error ? (
          <p role="alert" className="mt-5 text-paper">
            {v.error === "not_connected" ? t.notConnected : t.notListening}
          </p>
        ) : null}

        <div className="mt-6">
          <Button variant="primary" size="lg" icon="play" disabled={!connected || !e.listening} onClick={() => clenchStudy.start()}>
            {t.start}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Running() {
  const { m, f } = useI18n();
  const t = m.studies.clench;
  const v = useStore(clenchStudy.view);
  const plan = v.plan!;
  const total = plan.prompts.length;
  const last = v.detections[v.detections.length - 1];
  const heardRecently = last && v.elapsedMs - last.at < 2500;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="t-label">{v.free ? t.free : f(t.progress, { n: Math.min(v.cued, total), total })}</p>
          {v.condition && !v.free ? <p className="t-label">{t.conditions[v.condition]}</p> : null}
          {v.settings.record ? (
            <p className="t-label inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rec" aria-hidden="true" />
              {f(t.rawSamples, { n: v.recorded.toLocaleString() })}
            </p>
          ) : null}
          <p className="t-label ml-auto font-mono">{f(t.remaining, { t: clock(plan.freeTo - v.elapsedMs) })}</p>
        </div>
        <div className="mt-2 h-[3px] rounded-full bg-[var(--hairline)]">
          <div className="h-full rounded-full bg-paper/70 transition-[width]" style={{ width: `${(v.elapsedMs / plan.freeTo) * 100}%` }} />
        </div>

        <div className="flex min-h-[15rem] flex-col items-center justify-center py-8 text-center" aria-live="assertive">
          {v.free ? (
            <>
              <p className="t-display text-[clamp(2.2rem,8vw,3.4rem)] font-mono">{clock(plan.freeTo - v.elapsedMs)}</p>
              <p className="mt-4 max-w-[46ch] leading-relaxed text-mist">{t.freeBody}</p>
            </>
          ) : v.current ? (
            <p className="t-display text-[clamp(2.4rem,9vw,4rem)] leading-none text-signal">{t.cue[v.current.kind]}</p>
          ) : (
            <>
              <p className="t-display text-[clamp(1.6rem,6vw,2.4rem)] text-fog">{t.waiting}</p>
              {v.condition ? <p className="mt-3 text-mist">{t.conditionHint[v.condition]}</p> : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="min-h-6 text-[0.95rem] text-mist" aria-live="polite">
            {heardRecently ? f(t.heard, { kind: t.kinds[last.kind] }) : ""}
          </p>
          <Button className="ml-auto" variant="secondary" icon="stop" onClick={() => clenchStudy.stop()}>
            {t.stop}
          </Button>
        </div>
      </Card>
      <LiveTally />
    </div>
  );
}

function LiveTally() {
  const { m } = useI18n();
  const t = m.studies.clench;
  const v = useStore(clenchStudy.view);
  const s = v.score;
  if (!s) return null;
  return (
    <div className="grid grid-cols-3 gap-3">
      {CLENCH_KINDS.map((k) => (
        <div key={k} className="rounded-[12px] border border-[var(--hairline)] bg-well p-3">
          <p className="t-label">{t.kinds[k]}</p>
          <p className="mt-1 font-mono text-[1.15rem]">
            {s.byKind[k].caught}
            <span className="text-fog">/{s.byKind[k].prompted}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

function Chip({ ok }: { ok: boolean | null }) {
  const { m } = useI18n();
  const t = m.studies.clench;
  if (ok === null) return <span className="t-label">{t.noData}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline-strong)] px-2.5 py-0.5 text-[0.8rem]">
      <span aria-hidden="true">{ok ? "✓" : "×"}</span>
      {ok ? t.pass : t.fail}
    </span>
  );
}

function Rate({ s }: { s: KindScore }) {
  return (
    <span className="font-mono">
      {s.prompted ? fmtPct(s.rate, 0) : "-"}
      <span className="ml-1.5 text-fog">
        {s.caught}/{s.prompted}
      </span>
    </span>
  );
}

function Result() {
  const { m, f } = useI18n();
  const t = m.studies.clench;
  const v = useStore(clenchStudy.view);
  const s = v.score;
  if (!s) return null;
  const ms = (x: number | null) => (x === null ? "-" : `${Math.round(x)} ms`);

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle eyebrow={v.settings.participant || undefined} title={t.resultTitle} />
        {v.stoppedEarly ? <p className="mb-2 text-mist">{t.stoppedEarly}</p> : null}
        {v.settings.simulate ? <p className="mb-4 text-[0.92rem] text-fog">{t.simulatedNote}</p> : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[12px] border border-[var(--hairline)] bg-ink/40 p-4">
            <p className="t-label">{t.kinds.single}</p>
            <p className="mt-1 text-[1.5rem]">
              <Rate s={s.byKind.single} />
            </p>
            <div className="mt-2">
              <Chip ok={s.byKind.single.prompted ? s.pass.singles : null} />
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--hairline)] bg-ink/40 p-4">
            <p className="t-label">{t.falsePerHour}</p>
            <p className="mt-1 font-mono text-[1.5rem]">{s.falsePerHour === null ? "-" : s.falsePerHour.toFixed(1)}</p>
            <p className="text-[0.85rem] text-fog">
              {f(t.falseCount, { n: s.falseCount, min: s.freeMinutes < 10 ? Number(s.freeMinutes.toFixed(1)).toLocaleString() : Math.round(s.freeMinutes) })}
            </p>
            <div className="mt-2">
              <Chip ok={s.pass.falsePerHour} />
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--hairline)] bg-ink/40 p-4">
            <p className="t-label">{t.latency}</p>
            <p className="mt-1 font-mono text-[1.5rem]">{ms(s.latency.medianMs)}</p>
            <p className="text-[0.85rem] text-fog">
              {t.response}: {ms(s.response.medianMs)}
            </p>
            <div className="mt-2">
              <Chip ok={s.pass.latency} />
            </div>
          </div>
        </div>

        <h3 className="mt-7 text-[1.05rem]">{t.byKind}</h3>
        <table className="mt-2 w-full text-left text-[0.92rem]">
          <thead className="text-fog">
            <tr>
              <th className="py-1.5 pr-4 font-normal" />
              <th className="py-1.5 pr-4 font-normal">{t.caught}</th>
              <th className="py-1.5 pr-4 text-right font-normal">{t.misread}</th>
              <th className="py-1.5 text-right font-normal">{t.missed}</th>
            </tr>
          </thead>
          <tbody>
            {CLENCH_KINDS.map((k) => (
              <tr key={k} className="border-t border-[var(--hairline)]">
                <td className="py-2 pr-4">{t.kinds[k]}</td>
                <td className="py-2 pr-4">
                  <Rate s={s.byKind[k]} />
                </td>
                <td className="py-2 pr-4 text-right font-mono">{s.byKind[k].misread}</td>
                <td className="py-2 text-right font-mono">{s.byKind[k].missed}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mt-7 text-[1.05rem]">{t.byCondition}</h3>
        <table className="mt-2 w-full text-left text-[0.92rem]">
          <tbody>
            {STUDY_CONDITIONS.filter((c) => s.byCondition[c].prompted).map((c) => (
              <tr key={c} className="border-t border-[var(--hairline)]">
                <td className="py-2">{t.conditions[c]}</td>
                <td className="py-2">
                  <Rate s={s.byCondition[c]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mt-7 text-[1.05rem]">{t.confusion}</h3>
        <table className="mt-2 w-full text-left font-mono text-[0.92rem]">
          <thead className="text-fog">
            <tr>
              <th className="py-1.5 font-normal" />
              {[...CLENCH_KINDS, "none" as const].map((k) => (
                <th key={k} className="py-1.5 font-body font-normal">
                  {k === "none" ? t.none : t.kinds[k as ClenchKind]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CLENCH_KINDS.map((k) => (
              <tr key={k} className="border-t border-[var(--hairline)]">
                <td className="py-2 font-body">{t.kinds[k]}</td>
                {[...CLENCH_KINDS, "none" as const].map((c) => (
                  <td key={c} className="py-2">
                    {s.confusion[k][c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {s.extra ? <p className="mt-3 text-[0.92rem] text-mist">{f(t.extra, { n: s.extra })}</p> : null}

        <div className="mt-7 flex flex-wrap gap-3">
          <Button variant="primary" icon="download" onClick={() => clenchStudy.saveReport()}>
            {t.saveReport}
          </Button>
          <Button variant="secondary" icon="download" onClick={() => clenchStudy.saveCsv()}>
            {t.saveCsv}
          </Button>
          {clenchStudy.hasRaw ? (
            <Button variant="secondary" icon="download" onClick={() => clenchStudy.saveRaw()}>
              {t.saveRaw}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => clenchStudy.reset()}>
            {t.again}
          </Button>
        </div>
      </Card>
    </div>
  );
}
