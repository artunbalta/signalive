"use client";

import { TooltipCard, useRowTooltip } from "@/components/charts/Tooltip";
import { fmtPct } from "@/components/ui/Readout";
import { useI18n } from "@/components/providers/AppProviders";
import type { GroupStat } from "@/lib/shared/lab/aggregate";

/**
 * One small multiple: a row per group with the corpus WER as a dot and its
 * 95% bootstrap interval as a whisker, on an axis shared by every panel so
 * they compare at a glance. The value, interval and take count are printed in
 * the row (the tooltip adds CER and rows, never anything that is only there).
 */
export function GroupPanel({
  title,
  groups,
  labelOf,
  axisMax,
}: {
  title: string;
  groups: GroupStat[];
  labelOf: (key: string) => string;
  axisMax: number;
}) {
  const { m, f } = useI18n();
  const { active, bind } = useRowTooltip();
  const x = (v: number) => `${Math.max(0, Math.min(1, v / axisMax)) * 100}%`;
  const ticks = [0, axisMax / 2, axisMax];

  return (
    <section aria-label={title} className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-well p-5">
      <h3 className="text-[1.05rem]">{title}</h3>
      {groups.length === 0 ? (
        <p className="mt-3 text-[0.9rem] text-fog">-</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-[minmax(0,9rem)_1fr_auto] items-end gap-x-3 sm:grid-cols-[minmax(0,14rem)_1fr_10.5rem]">
            <span />
            <div className="relative h-4" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t} className="t-mono absolute -translate-x-1/2 text-[0.68rem] text-fog first:translate-x-0 last:-translate-x-full" style={{ left: x(t) }}>
                  {fmtPct(t, 0)}
                </span>
              ))}
            </div>
            <span className="t-mono hidden text-right text-[0.68rem] text-fog sm:block">
              {m.results.wer} · {m.results.ci} · {m.results.n}
            </span>
          </div>
          <ul className="mt-1">
            {groups.map((g) => {
              const { rate, lo, hi, n, rows } = g.wer;
              return (
                <li
                  key={g.key}
                  className="relative grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-x-3 rounded-[6px] py-2 outline-none focus-visible:bg-well-2 sm:grid-cols-[minmax(0,14rem)_1fr_10.5rem]"
                  aria-label={`${labelOf(g.key)}: ${fmtPct(rate)}`}
                  {...bind(g.key)}
                >
                  <span className="truncate text-[0.9rem]" title={labelOf(g.key)}>
                    {labelOf(g.key)}
                  </span>
                  <span className="relative h-5">
                    {ticks.map((t) => (
                      <span key={t} className="absolute inset-y-0 w-px bg-[var(--hairline)]" style={{ left: x(t) }} aria-hidden="true" />
                    ))}
                    {lo !== null && hi !== null ? (
                      <span
                        className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-mist/70"
                        style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {rate !== null ? (
                      <span
                        className={`absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--color-well)] ${active === g.key ? "bg-paper" : "bg-paper/85"}`}
                        style={{ left: x(rate) }}
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  <span className="t-mono text-right text-[0.78rem] leading-tight">
                    <span className="text-paper">{fmtPct(rate)}</span>
                    <span className="block text-fog sm:inline sm:pl-2">
                      {lo !== null && hi !== null ? `${fmtPct(lo, 0)}-${fmtPct(hi, 0)}` : "-"} · {n}
                    </span>
                  </span>
                  {active === g.key ? (
                    <TooltipCard
                      rows={[
                        { label: m.results.wer, value: fmtPct(rate) },
                        { label: m.results.ci, value: lo !== null && hi !== null ? f(m.results.range, { lo: fmtPct(lo), hi: fmtPct(hi) }) : "-" },
                        { label: m.results.cer, value: fmtPct(g.cer.rate) },
                        { label: m.results.n, value: `${n} (${rows})` },
                      ]}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
