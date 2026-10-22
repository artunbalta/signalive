import type { ReactNode } from "react";

/** A labelled measurement. Values are mono and tabular. */
export function Readout({ label, value, unit, note }: { label: string; value: ReactNode; unit?: string; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="t-label truncate">{label}</p>
      <p className="t-mono mt-1 text-[1.05rem] text-paper">
        {value}
        {unit ? <span className="ml-1 text-[0.8rem] text-fog">{unit}</span> : null}
      </p>
      {note ? <p className="mt-0.5 text-[0.8rem] text-fog">{note}</p> : null}
    </div>
  );
}

/** Two column definition list for measurement results. */
export function ReadoutRows({ rows }: { rows: { label: string; value: ReactNode; flag?: boolean }[] }) {
  return (
    <dl className="divide-y divide-[var(--hairline)]">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-[0.92rem] text-mist">{r.label}</dt>
          <dd className={`t-mono text-right text-[0.95rem] ${r.flag ? "text-paper underline decoration-dotted underline-offset-4" : "text-paper"}`}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Horizontal level meter in dBFS. The bar is amber while the input is live
 * (the attended signal), paper otherwise.
 */
export function LevelMeter({
  db,
  peakDb,
  live,
  floor = -60,
  label,
}: {
  db: number;
  peakDb?: number;
  live: boolean;
  floor?: number;
  label: string;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, (v - floor) / -floor)) * 100}%`;
  return (
    <div role="meter" aria-label={label} aria-valuemin={floor} aria-valuemax={0} aria-valuenow={Math.round(Math.max(db, floor))}>
      <div className="relative h-3 overflow-hidden rounded-full bg-well-2">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-75 ${live ? "bg-signal" : "bg-paper/70"}`}
          style={{ width: pct(db) }}
        />
        {peakDb !== undefined && Number.isFinite(peakDb) ? (
          <div className="absolute inset-y-0 w-[2px] bg-paper" style={{ left: pct(peakDb) }} />
        ) : null}
      </div>
      <div className="t-mono mt-1.5 flex justify-between text-[0.7rem] text-fog">
        <span>{floor} dB</span>
        <span>-30</span>
        <span>0 dBFS</span>
      </div>
    </div>
  );
}

/*
 * Measurement formatting follows the interface language: Turkish writes
 * "%17,6" and "1,21 sn" where English writes "17.6%" and "1.21 s".
 * AppProviders sets the locale once per render.
 */
let numberLocale: "en" | "tr" = "en";
export function setFormatLocale(l: "en" | "tr") {
  numberLocale = l;
}
const nf = (digits: number) =>
  new Intl.NumberFormat(numberLocale === "tr" ? "tr-TR" : "en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export function fmtDb(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-inf";
  return nf(1).format(v);
}

export function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return v >= 1000 ? `${nf(2).format(v / 1000)} ${numberLocale === "tr" ? "sn" : "s"}` : `${Math.round(v)} ms`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  return new Intl.NumberFormat(numberLocale === "tr" ? "tr-TR" : "en-GB", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function fmtHz(v: number | null | undefined): string {
  if (!v) return "-";
  return v >= 1000 ? `${nf(v % 1000 === 0 ? 0 : 1).format(v / 1000)} kHz` : `${Math.round(v)} Hz`;
}
