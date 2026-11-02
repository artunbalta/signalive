"use client";

import { useState } from "react";
import { research } from "@/lib/copy";

/**
 * Every configuration the analysis ran, one at a time: electrodes per ear,
 * wired or wireless (or one earbud), generic or personal decoder. Nothing is
 * computed here; the numbers are research/aad's, held out, for 36 people.
 */

type Kind = { mean: Record<string, number>; mesdMedian: number | null; above60: number };
export type ExplorerConfigs = Record<string, { generic: Kind; personal: Kind }>;

const COUNTS = ["2", "3", "4", "6", "8", "all"] as const;
const FORMS = ["wireless", "wired", "right", "left"] as const;
const DECODERS = ["generic", "personal"] as const;
const WINDOWS = ["2", "10", "60"];

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

function Choice<T extends string>({ label, options, value, names, onChange, disabled }: { label: string; options: readonly T[]; value: T; names: Record<T, string>; onChange: (v: T) => void; disabled?: (v: T) => boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="t-mono text-fog">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            disabled={disabled?.(o)}
            className="room-pill research-choice disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onChange(o)}
          >
            {names[o]}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Explorer({ configs }: { configs: ExplorerConfigs }) {
  const c = research.explorer;
  const [count, setCount] = useState<(typeof COUNTS)[number]>("4");
  const [form, setForm] = useState<(typeof FORMS)[number]>("wireless");
  const [decoder, setDecoder] = useState<(typeof DECODERS)[number]>("generic");
  const oneEar = form === "left" || form === "right";
  const n = oneEar && count === "all" ? "8" : count;
  const k = configs[`${form}_${n}`]?.[decoder];
  const countNames = Object.fromEntries(COUNTS.map((x) => [x, x === "all" ? c.all : x])) as Record<(typeof COUNTS)[number], string>;

  return (
    <div className="grid12 gap-y-12">
      <div className="col-span-12 flex flex-col gap-8 lg:col-span-6">
        <Choice label={c.electrodes} options={COUNTS} value={count} names={countNames} onChange={setCount} disabled={(o) => oneEar && o === "all"} />
        <Choice label={c.form} options={FORMS} value={form} names={c.forms} onChange={setForm} />
        <Choice label={c.decoder} options={DECODERS} value={decoder} names={c.decoders} onChange={setDecoder} />
        {oneEar ? <p className="text-small text-fog">{c.allOneEar}</p> : null}
      </div>
      {k ? (
        <dl className="col-span-12 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:col-span-6" aria-live="polite">
          {WINDOWS.map((w) => (
            <div key={w} className="flex flex-col gap-2 border-t border-hairline pt-4">
              <dt className="text-small text-mist">{c.at.replace("{n}", w)}</dt>
              <dd className="research-explorer-value">{pct(k.mean[w])}</dd>
            </div>
          ))}
          <div className="flex flex-col gap-2 border-t border-hairline pt-4">
            <dt className="text-small text-mist">{c.switch}</dt>
            <dd className="research-explorer-value">{k.mesdMedian === null ? "" : c.switchValue.replace("{n}", String(Math.round(k.mesdMedian)))}</dd>
          </div>
          <div className="col-span-2 flex flex-col gap-2 border-t border-hairline pt-4">
            <dt className="text-small text-mist">{c.people}</dt>
            <dd className="research-explorer-value">{c.peopleValue.replace("{n}", String(k.above60))}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
