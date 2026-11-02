"use client";

import { useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/* ==========================================================================
   The research page's charts. Marks are drawn in an SVG stretched over the
   plot (viewBox 0 0 1000 1000, strokes that do not scale); every piece of
   text, every dot and the hover readout are HTML on top, so labels keep their
   CSS size on a phone instead of shrinking with a viewBox.

   Emphasis, not categories: the series a chart is about is paper, context is
   mist and fog, all direct labelled and named in a legend. Amber is not used
   here; on this site it marks only what is attended or live.
   ========================================================================== */

const V = 1000;

export type Series = { id: string; label: string; values: number[]; tone: "paper" | "mist" | "fog" };

const TONE = { paper: "var(--color-paper)", mist: "var(--color-mist)", fog: "var(--color-fog)" } as const;

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** Where a value sits in the plot, 0 to 100, for both the SVG and the HTML layer. */
function scale(domain: [number, number], v: number) {
  return ((v - domain[0]) / (domain[1] - domain[0])) * 100;
}

function YAxis({ ticks, domain, label }: { ticks: number[]; domain: [number, number]; label: string }) {
  return (
    <>
      {ticks.map((t) => (
        <span
          key={t}
          className="chart-tick absolute right-full mr-2 -translate-y-1/2"
          style={{ top: `${100 - scale(domain, t)}%` }}
        >
          {pct(t)}
        </span>
      ))}
      <span className="sr-only">{label}</span>
    </>
  );
}

function Grid({ ticks, domain }: { ticks: number[]; domain: [number, number] }) {
  return (
    <>
      {ticks.map((t) => {
        const y = V - (scale(domain, t) / 100) * V;
        return <line key={t} x1={0} x2={V} y1={y} y2={y} className="chart-grid" vectorEffect="non-scaling-stroke" />;
      })}
    </>
  );
}

/** Position on a log axis of seconds, so 1, 2, 5 and 60 s all get room. */
function logX(xs: number[], v: number) {
  const a = Math.log(xs[0]);
  const b = Math.log(xs[xs.length - 1]);
  return ((Math.log(v) - a) / (b - a)) * 100;
}

/**
 * Lines over decision window length. The crosshair snaps to the nearest
 * window and the readout lists every series there, values first.
 */
export function WindowChart({
  xs,
  series,
  band,
  bandLabel,
  domain,
  ticks,
  labelled,
  xLabel,
  yLabel,
  label,
}: {
  xs: number[];
  series: Series[];
  /** Per window; null where one person's result cannot be told from chance at all. */
  band: (number | null)[];
  bandLabel: string;
  domain: [number, number];
  ticks: number[];
  /** Window lengths that get a tick label; the rest are plotted unlabelled. */
  labelled?: number[];
  xLabel: string;
  yLabel: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const px = xs.map((x) => logX(xs, x));
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i ? "L" : "M"}${(px[i] / 100) * V},${V - (scale(domain, v) / 100) * V}`).join("");
  // The band runs as far as a single person's chance level is defined.
  const bandVals = band.filter((b): b is number => b !== null);
  const bandEnd = (px[bandVals.length - 1] / 100) * V;
  const bandPath = path(bandVals) + `L${bandEnd},${V}L0,${V}Z`;

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const r = plot.current!.getBoundingClientRect();
    const f = ((e.clientX - r.left) / r.width) * 100;
    let best = 0;
    px.forEach((p, i) => {
      if (Math.abs(p - f) < Math.abs(px[best] - f)) best = i;
    });
    setHover(best);
  }

  return (
    <figure className="chart" aria-label={label}>
      <Legend series={series} />
      <div className="chart-frame">
        <div
          ref={plot}
          className="chart-plot"
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={label}
        >
          <svg viewBox={`0 0 ${V} ${V}`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
            <Grid ticks={ticks} domain={domain} />
            <path d={bandPath} className="chart-band" />
            <path d={path(bandVals)} className="chart-band-edge" vectorEffect="non-scaling-stroke" />
            {[...series].reverse().map((s) => (
              <path key={s.id} d={path(s.values)} fill="none" stroke={TONE[s.tone]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <YAxis ticks={ticks} domain={domain} label={yLabel} />
          {/* The series the chart is about gets its end value; the others
              converge there, so the legend and the readout carry them. */}
          <span
            className="chart-endlabel absolute left-full ml-3 -translate-y-1/2 whitespace-nowrap"
            style={{ top: `${100 - scale(domain, series[0].values[series[0].values.length - 1])}%` }}
          >
            {pct(series[0].values[series[0].values.length - 1])}
          </span>
          {series.map((s) => (
            <span
              key={`${s.id}-dot`}
              aria-hidden="true"
              className="chart-dot"
              style={{ left: `${px[px.length - 1]}%`, top: `${100 - scale(domain, s.values[s.values.length - 1])}%`, background: TONE[s.tone] }}
            />
          ))}
          <span className="chart-bandlabel absolute" style={{ left: "1%", top: `${100 - scale(domain, bandVals[0])}%` }}>
            {bandLabel}
          </span>
          {hover !== null ? (
            <>
              <span aria-hidden="true" className="chart-crosshair" style={{ left: `${px[hover]}%` }} />
              <div className="chart-tip" data-flip={px[hover] > 55 || undefined} style={{ left: `${px[hover]}%` }}>
                <p className="chart-tip-head">{xs[hover]} s</p>
                {series.map((s) => (
                  <p key={s.id} className="chart-tip-row">
                    <span aria-hidden="true" className="chart-key" style={{ background: TONE[s.tone] }} />
                    <b>{pct(s.values[hover])}</b>
                    <span>{s.label}</span>
                  </p>
                ))}
                {band[hover] !== null ? (
                  <p className="chart-tip-row">
                    <span aria-hidden="true" className="chart-key chart-key-band" />
                    <b>{pct(band[hover] as number)}</b>
                    <span>{bandLabel}</span>
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
        <div className="chart-xaxis">
          {xs.map((x, i) =>
            !labelled || labelled.includes(x) ? (
              <span key={x} className="chart-tick absolute -translate-x-1/2" style={{ left: `${px[i]}%` }}>
                {x}
              </span>
            ) : null,
          )}
        </div>
        <p className="chart-xlabel">{xLabel}</p>
      </div>
    </figure>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="chart-legend">
      {series.map((s) => (
        <li key={s.id}>
          <span aria-hidden="true" className="chart-key" style={{ background: TONE[s.tone] }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * One column per electrode count. The count the design targets is paper;
 * the others are fog, so the column the story is about stands out.
 */
export function ColumnChart({
  bars,
  domain,
  ticks,
  xLabel,
  yLabel,
  label,
}: {
  bars: { label: string; value: number; emphasis?: boolean }[];
  domain: [number, number];
  ticks: number[];
  xLabel: string;
  yLabel: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = bars.length;
  return (
    <figure className="chart" aria-label={label}>
      <div className="chart-frame">
        <div className="chart-plot" role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${V} ${V}`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full">
            <Grid ticks={ticks} domain={domain} />
          </svg>
          <YAxis ticks={ticks} domain={domain} label={yLabel} />
          {bars.map((b, i) => {
            const h = scale(domain, b.value);
            return (
              <button
                key={b.label}
                type="button"
                className="chart-colhit"
                style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%` }}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${b.label}: ${pct(b.value)}`}
              >
                <span
                  aria-hidden="true"
                  className="chart-col"
                  data-on={b.emphasis || hover === i || undefined}
                  data-emphasis={b.emphasis || undefined}
                  style={{ height: `${h}%` }}
                />
                {/* Labelled selectively: the column the story is about, the last one, and the one under the pointer. */}
                {b.emphasis || i === n - 1 || hover === i ? (
                  <span aria-hidden="true" className="chart-collabel" style={{ bottom: `calc(${h}% + 6px)` }}>
                    {pct(b.value)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="chart-xaxis">
          {bars.map((b, i) => (
            <span key={b.label} className="chart-tick absolute -translate-x-1/2" style={{ left: `${((i + 0.5) / n) * 100}%` }}>
              {b.label}
            </span>
          ))}
        </div>
        <p className="chart-xlabel">{xLabel}</p>
      </div>
    </figure>
  );
}

/**
 * Minutes of a person's own data against accuracy, with the decoder trained
 * on other people as the line to beat: it needs none of the person's data.
 */
export function CalibrationChart({
  xs,
  series,
  reference,
  domain,
  ticks,
  xLabel,
  yLabel,
  label,
}: {
  xs: number[];
  series: Series;
  reference: { value: number; label: string };
  domain: [number, number];
  ticks: number[];
  xLabel: string;
  yLabel: string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  // Evenly spaced minutes: 1, 2, 5, 10, 20 read as steps, not as a scale.
  const px = xs.map((_, i) => 4 + (i / (xs.length - 1)) * 92);
  const y = (v: number) => V - (scale(domain, v) / 100) * V;
  const d = series.values.map((v, i) => `${i ? "L" : "M"}${(px[i] / 100) * V},${y(v)}`).join("");
  const keys: Series[] = [{ id: "reference", label: reference.label, values: [reference.value], tone: "paper" }, series];

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const r = plot.current!.getBoundingClientRect();
    const f = ((e.clientX - r.left) / r.width) * 100;
    let best = 0;
    px.forEach((p, i) => {
      if (Math.abs(p - f) < Math.abs(px[best] - f)) best = i;
    });
    setHover(best);
  }

  return (
    <figure className="chart" aria-label={label}>
      <Legend series={keys} />
      <div className="chart-frame">
        <div ref={plot} className="chart-plot" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label={label}>
          <svg viewBox={`0 0 ${V} ${V}`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
            <Grid ticks={ticks} domain={domain} />
            <line x1={0} x2={V} y1={y(reference.value)} y2={y(reference.value)} stroke={TONE.paper} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <path d={d} fill="none" stroke={TONE[series.tone]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <YAxis ticks={ticks} domain={domain} label={yLabel} />
          {series.values.map((v, i) => (
            <span key={i} aria-hidden="true" className="chart-dot" style={{ left: `${px[i]}%`, top: `${100 - scale(domain, v)}%`, background: TONE[series.tone] }} />
          ))}
          <span className="chart-endlabel absolute left-full ml-3 -translate-y-1/2 whitespace-nowrap" style={{ top: `${100 - scale(domain, reference.value)}%` }}>
            {pct(reference.value)}
          </span>
          <span
            className="chart-endlabel absolute left-full ml-3 -translate-y-1/2 whitespace-nowrap"
            data-quiet
            style={{ top: `${100 - scale(domain, series.values[series.values.length - 1])}%` }}
          >
            {pct(series.values[series.values.length - 1])}
          </span>
          {hover !== null ? (
            <>
              <span aria-hidden="true" className="chart-crosshair" style={{ left: `${px[hover]}%` }} />
              <div className="chart-tip" data-flip={px[hover] > 55 || undefined} style={{ left: `${px[hover]}%` }}>
                <p className="chart-tip-head">{xs[hover]} min</p>
                <p className="chart-tip-row">
                  <span aria-hidden="true" className="chart-key" style={{ background: TONE[series.tone] }} />
                  <b>{pct(series.values[hover])}</b>
                  <span>{series.label}</span>
                </p>
                <p className="chart-tip-row">
                  <span aria-hidden="true" className="chart-key" style={{ background: TONE.paper }} />
                  <b>{pct(reference.value)}</b>
                  <span>{reference.label}</span>
                </p>
              </div>
            </>
          ) : null}
        </div>
        <div className="chart-xaxis">
          {xs.map((x, i) => (
            <span key={x} className="chart-tick absolute -translate-x-1/2" style={{ left: `${px[i]}%` }}>
              {x}
            </span>
          ))}
        </div>
        <p className="chart-xlabel">{xLabel}</p>
      </div>
    </figure>
  );
}

/**
 * One dot per person on an accuracy axis, stacked where they collide so
 * every person stays visible. The three people the replay offers are named.
 */
export function StripChart({
  values,
  marks,
  bar,
  barLabel,
  domain,
  ticks,
  label,
  ringLabel,
}: {
  values: number[];
  marks: { index: number; label: string }[];
  bar: number;
  barLabel: string;
  ringLabel: string;
  domain: [number, number];
  ticks: number[];
  label: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  // Equal values stack upward in rows, centred, so the strip reads as a histogram of people.
  const placed = useMemo(() => {
    const rows = new Map<number, number>();
    return values.map((v) => {
      const key = Math.round(v * 30);
      const row = rows.get(key) ?? 0;
      rows.set(key, row + 1);
      return { v, row };
    });
  }, [values]);
  const maxRow = Math.max(...placed.map((p) => p.row)) + 1;
  return (
    <figure className="chart" aria-label={label}>
      <div className="chart-frame">
        <div className="chart-strip" role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
          <span aria-hidden="true" className="chart-bar" style={{ left: `${scale(domain, bar)}%` }} />
          <span className="chart-barlabel" style={{ left: `${scale(domain, bar)}%` }}>
            {barLabel}
          </span>
          {placed.map((p, i) => {
            const mark = marks.find((m) => m.index === i);
            return (
              <button
                key={i}
                type="button"
                className="chart-person"
                data-above={p.v >= bar || undefined}
                style={{ left: `${scale(domain, p.v)}%`, bottom: `calc(${(p.row / maxRow) * 70}% + 14px)` }}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-describedby={hover === i ? `${id}-tip` : undefined}
                data-marked={mark ? true : undefined}
                aria-label={`${pct(p.v)}${mark ? `, ${mark.label}` : ""}`}
              >
                <span aria-hidden="true" />
              </button>
            );
          })}
          {hover !== null ? (
            <div id={`${id}-tip`} role="tooltip" className="chart-tip" data-flip={scale(domain, values[hover]) > 55 || undefined} style={{ left: `${scale(domain, values[hover])}%`, top: 0 }}>
              <p className="chart-tip-row">
                <b>{pct(values[hover])}</b>
                <span>{marks.find((m) => m.index === hover)?.label ?? `#${hover + 1}`}</span>
              </p>
            </div>
          ) : null}
        </div>
        <div className="chart-xaxis">
          {ticks.map((t) => (
            <span key={t} className="chart-tick absolute -translate-x-1/2" style={{ left: `${scale(domain, t)}%` }}>
              {pct(t)}
            </span>
          ))}
        </div>
        <p className="chart-xlabel inline-flex items-center gap-2">
          <span aria-hidden="true" className="chart-ring" />
          {ringLabel}
        </p>
      </div>
    </figure>
  );
}
