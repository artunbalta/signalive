"use client";

import { useEffect } from "react";
import { useI18n } from "@/components/providers/AppProviders";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Callout, Card, SectionTitle } from "@/components/ui/Card";
import { Checkbox, Field, Segmented } from "@/components/ui/Controls";
import { fmtPct } from "@/components/ui/Readout";
import { earbuds } from "@/lib/client/earbuds";
import { useStore } from "@/lib/client/store";
import { FULL_ATTENTION, QUICK_ATTENTION, attentionStudy } from "@/lib/client/studies/attention-runner";

/**
 * The attention study's three screens: choose how it runs (your earbuds or
 * board with two recordings of speech, or the replay of two real people),
 * run it (the cue, and what the earbuds believe), and the result.
 */
export function AttentionStudy() {
  const v = useStore(attentionStudy.view);
  useEffect(() => () => attentionStudy.stop(), []);
  if (v.stage === "running") return <Running />;
  if (v.stage === "done") return <Result />;
  return <Setup />;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Setup() {
  const { m } = useI18n();
  const t = m.studies.attention;
  const v = useStore(attentionStudy.view);
  const e = useStore(earbuds.view);
  const replay = v.settings.source === "replay";
  const connected = e.phase === "connected";
  const quick = v.settings.minutes === QUICK_ATTENTION.minutes;
  const loading = v.stage === "loading";
  const ready = replay || (connected && v.files.length === 2);

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle eyebrow={m.studies.eyebrow} title={t.title} />
        <p className="max-w-[60ch] leading-relaxed text-mist">{t.summary}</p>
        <p className="mt-2 text-[0.92rem] text-fog">{t.bars}</p>

        <div className="mt-6 grid gap-5">
          <Field label={t.source}>
            <Segmented
              label={t.source}
              value={v.settings.source}
              options={[
                { value: "files", label: t.sources.files },
                { value: "replay", label: t.sources.replay },
              ]}
              onChange={(source) => attentionStudy.configure({ source })}
            />
          </Field>

          {replay ? (
            <p className="max-w-[62ch] text-[0.95rem] leading-relaxed text-mist">{t.replayBody}</p>
          ) : (
            <>
              {!connected ? (
                <Callout
                  kind="info"
                  title={t.connectFirst}
                  action={
                    <ButtonLink href="/earbuds" variant="ghost">
                      {m.studies.clench.goEarbuds}
                    </ButtonLink>
                  }
                >
                  {t.connectBody}
                </Callout>
              ) : null}
              <Field label={t.voices} hint={t.voicesHint}>
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  aria-label={t.voices}
                  onChange={(ev) => attentionStudy.chooseFiles(Array.from(ev.target.files ?? []))}
                  className="block w-full text-[0.92rem] text-mist file:mr-4 file:min-h-11 file:rounded-full file:border file:border-[var(--hairline-strong)] file:bg-well file:px-4 file:text-paper"
                />
              </Field>
              {v.files.length ? (
                <ul className="space-y-1 text-[0.92rem]">
                  {v.files.map((f, i) => (
                    <li key={f.name + i} className="flex gap-3">
                      <span className="t-label w-16 shrink-0">{i === 0 ? t.left : t.right}</span>
                      <span className="min-w-0 truncate">{f.name}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Field label={t.output}>
                <Segmented
                  label={t.output}
                  value={v.settings.output}
                  options={[
                    { value: "headphones", label: t.outputs.headphones },
                    { value: "speakers", label: t.outputs.speakers },
                  ]}
                  onChange={(output) => attentionStudy.configure({ output })}
                />
              </Field>
              <Field label={m.studies.clench.length}>
                <Segmented
                  label={m.studies.clench.length}
                  value={quick ? "quick" : "full"}
                  options={[
                    { value: "full", label: t.full },
                    { value: "quick", label: t.quick },
                  ]}
                  onChange={(val) => attentionStudy.configure(val === "quick" ? QUICK_ATTENTION : FULL_ATTENTION)}
                />
              </Field>
            </>
          )}

          <Field label={m.studies.clench.participant} hint={m.studies.clench.participantHint}>
            <input
              aria-label={m.studies.clench.participant}
              value={v.settings.participant}
              onChange={(ev) => attentionStudy.configure({ participant: ev.target.value.slice(0, 24) })}
              placeholder="P01"
              autoComplete="off"
              spellCheck={false}
              className="min-h-12 w-full max-w-[16rem] rounded-[12px] border border-[var(--hairline-strong)] bg-ink px-4 font-mono text-paper outline-none focus:border-signal"
            />
          </Field>
          <Checkbox checked={v.settings.record} onChange={(on) => attentionStudy.configure({ record: on })}>
            {m.studies.clench.record}
            <span className="mt-1 block text-[0.85rem] text-fog">{t.recordHint}</span>
          </Checkbox>
        </div>

        {v.error ? (
          <p role="alert" className="mt-5 text-paper">
            {t.errors[v.error]}
          </p>
        ) : null}

        <div className="mt-6">
          <Button variant="primary" size="lg" icon="play" disabled={!ready || loading} busy={loading} onClick={() => void attentionStudy.start()}>
            {loading ? t.loading : t.start}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Running() {
  const { m, f } = useI18n();
  const t = m.studies.attention;
  const v = useStore(attentionStudy.view);
  const plan = v.plan!;
  const last = v.decisions[v.decisions.length - 1];
  const sides = [t.left, t.right];

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="t-label">{v.settings.source === "replay" ? t.sources.replay : t.sources.files}</p>
          {v.settings.record ? (
            <p className="t-label inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rec" aria-hidden="true" />
              {f(m.studies.clench.rawSamples, { n: v.recorded.toLocaleString() })}
            </p>
          ) : null}
          <p className="t-label ml-auto font-mono">{f(m.studies.clench.remaining, { t: clock(plan.durationMs - v.elapsedMs) })}</p>
        </div>
        <div className="mt-2 h-[3px] rounded-full bg-[var(--hairline)]">
          <div className="h-full rounded-full bg-paper/70 transition-[width]" style={{ width: `${(v.elapsedMs / plan.durationMs) * 100}%` }} />
        </div>

        <div className="flex min-h-[13rem] flex-col items-center justify-center py-8 text-center" aria-live="assertive">
          {v.cue ? (
            <>
              <p aria-hidden="true" className="t-display text-[clamp(2.6rem,10vw,4.4rem)] leading-none text-signal">
                {v.cue.talker === 0 ? "←" : "→"}
              </p>
              <p className="t-display mt-3 text-[clamp(1.7rem,6.5vw,2.6rem)] leading-tight text-signal">{v.cue.talker === 0 ? t.followLeft : t.followRight}</p>
            </>
          ) : (
            <p className="t-display text-[clamp(1.5rem,5.5vw,2.2rem)] text-fog">{t.settling}</p>
          )}
        </div>

        <h3 className="t-label">{t.belief}</h3>
        <div className="mt-2 grid gap-2">
          {sides.map((label, i) => {
            const p = v.belief?.[i] ?? 0.5;
            return (
              <div key={label} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-[0.9rem] text-mist">{label}</span>
                <div className="h-2 flex-1 rounded-full bg-[var(--hairline)]">
                  <div className="h-full rounded-full bg-paper/80 transition-[width] duration-500" style={{ width: `${Math.round(p * 100)}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-[0.9rem]">{v.belief ? fmtPct(p, 0) : "-"}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 min-h-6 text-[0.92rem] text-fog" aria-live="polite">
          {last ? f(t.lastDecision, { side: sides[last.talker] ?? "-" }) : t.noDecision}
        </p>

        <div className="mt-4 flex justify-end">
          <Button variant="secondary" icon="stop" onClick={() => attentionStudy.stop()}>
            {m.studies.clench.stop}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Result() {
  const { m, f } = useI18n();
  const t = m.studies.attention;
  const v = useStore(attentionStudy.view);
  const s = v.score;
  if (!s) return null;
  const sec = (ms: number | null) => (ms === null ? "-" : `${Math.round(ms / 1000)} s`);

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle eyebrow={v.settings.participant || undefined} title={m.studies.clench.resultTitle} />
        {v.stoppedEarly ? <p className="mb-2 text-mist">{m.studies.clench.stoppedEarly}</p> : null}
        {v.settings.source === "replay" ? <p className="mb-4 text-[0.92rem] text-fog">{t.replayNote}</p> : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[12px] border border-[var(--hairline)] bg-ink/40 p-4">
            <p className="t-label">{t.decisionsRight}</p>
            <p className="mt-1 font-mono text-[1.5rem]">{s.accuracy === null ? "-" : fmtPct(s.accuracy, 0)}</p>
            <p className="text-[0.85rem] text-fog">{f(t.ofDecisions, { right: s.right, n: s.decisions })}</p>
          </div>
          <div className="rounded-[12px] border border-[var(--hairline)] bg-ink/40 p-4">
            <p className="t-label">{t.beliefRight}</p>
            <p className="mt-1 font-mono text-[1.5rem]">{s.beliefRight === null ? "-" : fmtPct(s.beliefRight, 0)}</p>
            <p className="text-[0.85rem] text-fog">{t.beliefRightHint}</p>
          </div>
          <div className="rounded-[12px] border border-[var(--hairline)] bg-ink/40 p-4">
            <p className="t-label">{t.switchTime}</p>
            <p className="mt-1 font-mono text-[1.5rem]">{sec(s.switchMedianMs)}</p>
            <p className="text-[0.85rem] text-fog">{f(t.followedOf, { followed: s.followed, n: s.switches.length })}</p>
          </div>
        </div>
        <p className="mt-4 max-w-[64ch] text-[0.92rem] leading-relaxed text-fog">{t.prediction}</p>

        <h3 className="mt-7 text-[1.05rem]">{t.bySince}</h3>
        <table className="mt-2 w-full text-left text-[0.92rem]">
          <tbody>
            {s.bySinceSwitch.map((b) => (
              <tr key={b.fromS} className="border-t border-[var(--hairline)]">
                <td className="py-2 pr-4">{b.toS === null ? f(t.sinceOver, { from: b.fromS }) : f(t.sinceRange, { from: b.fromS, to: b.toS })}</td>
                <td className="py-2 pr-4 text-right font-mono">{b.accuracy === null ? "-" : fmtPct(b.accuracy, 0)}</td>
                <td className="py-2 text-right font-mono text-fog">{b.n}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {s.switches.length ? (
          <>
            <h3 className="mt-7 text-[1.05rem]">{t.switches}</h3>
            <table className="mt-2 w-full text-left font-mono text-[0.92rem]">
              <tbody>
                {s.switches.map((w) => (
                  <tr key={w.at} className="border-t border-[var(--hairline)]">
                    <td className="py-2 pr-4">{clock(w.at)}</td>
                    <td className="py-2 pr-4 font-body">{w.to === 0 ? t.left : t.right}</td>
                    <td className="py-2 text-right">{w.tookMs === null ? <span className="font-body text-fog">{t.missed}</span> : sec(w.tookMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        <div className="mt-7 flex flex-wrap gap-3">
          <Button variant="primary" icon="download" onClick={() => attentionStudy.saveReport()}>
            {m.studies.clench.saveReport}
          </Button>
          {attentionStudy.hasRaw ? (
            <Button variant="secondary" icon="download" onClick={() => attentionStudy.saveRaw()}>
              {m.studies.clench.saveRaw}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => attentionStudy.reset()}>
            {m.studies.clench.again}
          </Button>
        </div>
      </Card>
    </div>
  );
}
