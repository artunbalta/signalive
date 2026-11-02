import type { ReactNode } from "react";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { research } from "@/lib/copy";
import results from "@/public/research/results.json";
import { CalibrationChart, ColumnChart, StripChart, WindowChart } from "./charts";
import EarMap from "./EarMap";
import Explorer, { type ExplorerConfigs } from "./Explorer";
import { LazyConsole, LazyReplay } from "./Lazy";

/* ==========================================================================
   /research. The decoder run on public ear EEG from 36 people. Server
   rendered: every number is read from public/research/results.json, which
   research/aad/export.py writes, so the copy can never drift from the data.
   Only the charts' hover layer, the replay and the console run script.
   ========================================================================== */

type Summary = { mean: Record<string, number>; mesdMedian: number | null; above60: number };
type Config = { generic: Summary; personal: Summary; perSubject60: number[]; electrodes: string[] };
const R = results as unknown as {
  windows: number[];
  chance: Record<string, number | null>;
  configs: Record<string, Config>;
  calibration: { personal: Record<string, Record<string, number>>; adapted: Record<string, Record<string, number>> };
  electrodeOrder: { left: string[]; right: string[] };
  people: { label: "clearest" | "typical" | "hardest"; id: string; accuracy60: number; attended: string }[];
  dataset: { doi: string; paper: string; people: number };
};

const INK = "bg-ink text-paper";
const PAPER = "surface-paper bg-paper text-ink";
const REPO = "https://github.com/artunbalta/signalive/tree/main";
const DOMAIN: [number, number] = [0.45, 0.75];
const TICKS = [0.5, 0.6, 0.7];

const g60 = (name: string) => R.configs[name].generic.mean["60"];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fill = (s: string, n: string | number, m?: string | number) => s.replace("{n}", String(n)).replace("{m}", String(m ?? ""));

export function ResearchHero() {
  const head = R.configs.wireless_4.generic;
  const lost = (g60("wired_4") - g60("wireless_4")) * 100;
  const tiles = [
    { key: "accuracy", value: pct(head.mean["60"]), copy: research.stats.accuracy },
    { key: "wireless", value: `${lost.toFixed(1)}`, unit: research.points, copy: research.stats.wireless },
    { key: "calibration", value: "0", unit: research.minutes, copy: research.stats.calibration },
    { key: "speed", value: `${Math.round((head.mesdMedian ?? 0) / 60)}`, unit: research.minutes, copy: research.stats.speed },
  ];
  return (
    <section id="research-hero" aria-labelledby="research-heading" className={`section ${INK} pt-[calc(var(--bar-h)+var(--nav-h)+var(--rhythm))]`}>
      <div className="shell">
        <Reveal>
          <p className="t-mono text-fog">
            {research.eyebrow}
            <span className="ml-4">{research.date}</span>
          </p>
        </Reveal>
        <MaskHeadline as="h1" id="research-heading" lines={research.headlineLines} className="t-h1 mt-6" />
        <Reveal className="mt-8 max-w-[52ch]">
          <p className="t-lead text-mist">{research.lead}</p>
        </Reveal>
        <Reveal as="ul" className="mt-[var(--rhythm)] grid grid-cols-1 gap-x-8 gap-y-12 border-t border-hairline pt-10 sm:grid-cols-2 lg:grid-cols-4" staggerChildren={80}>
          {tiles.map((t) => (
            <li key={t.key} className="flex flex-col gap-4">
              <p className="research-stat-value">
                {t.value}
                {t.unit ? <span className="ml-2 text-[0.4em] tracking-normal text-mist">{t.unit}</span> : null}
              </p>
              <p className="text-body">{t.copy.label}</p>
              <p className="text-small leading-relaxed text-fog">{t.copy.sub}</p>
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function ReplaySection() {
  const people = R.people.map((p) => ({ ...p, name: research.replay.people[p.label] }));
  return (
    <section id="replay" aria-labelledby="replay-heading" className={`section ${INK} border-t border-hairline`}>
      <div className="shell grid12">
        <div className="col-span-12 lg:col-span-4">
          <Reveal>
            <p className="t-mono text-fog">{research.replay.eyebrow}</p>
          </Reveal>
          <MaskHeadline id="replay-heading" lines={research.replay.headlineLines} className="t-h1 mt-6" />
          <Reveal className="mt-8">
            <p className="text-body text-mist">{research.replay.body}</p>
          </Reveal>
          <Reveal className="mt-6">
            <p className="text-small leading-relaxed text-fog">{research.replay.noAudio}</p>
          </Reveal>
        </div>
        <div className="col-span-12 mt-12 lg:col-span-8 lg:mt-0">
          <LazyReplay people={people} />
        </div>
      </div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="research-details mt-6">
      <summary>{research.tableToggle}</summary>
      <div className="mt-4 overflow-x-auto">
        <table className="research-table">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Finding({ id, copy, body, children }: { id: string; copy: { index: string; headlineLines: string[] }; body: string; children: ReactNode }) {
  return (
    <article id={id} aria-labelledby={`${id}-heading`} className="grid12 border-t border-hairline pt-12 lg:pt-16">
      <div className="col-span-12 lg:col-span-4">
        <Reveal>
          <p className="t-mono text-fog">{copy.index}</p>
        </Reveal>
        <MaskHeadline as="h3" id={`${id}-heading`} lines={copy.headlineLines} className="t-h2 mt-5" />
        <Reveal className="mt-6">
          <p className="text-body text-mist">{body}</p>
        </Reveal>
      </div>
      <Reveal className="col-span-12 mt-10 lg:col-span-7 lg:col-start-6 lg:mt-0" delay={100}>
        {children}
      </Reveal>
    </article>
  );
}

export function Findings() {
  const f = research.findings;
  const W = R.windows;
  const series = [
    { id: "wireless", label: f.window.series.wireless, values: W.map((w) => R.configs.wireless_4.generic.mean[String(w)]), tone: "paper" as const },
    { id: "wired", label: f.window.series.wired, values: W.map((w) => R.configs.wired_all.generic.mean[String(w)]), tone: "mist" as const },
    { id: "one", label: f.window.series.one, values: W.map((w) => R.configs.right_4.generic.mean[String(w)]), tone: "fog" as const },
  ];
  const band = W.map((w) => R.chance[String(w)] ?? null);

  const counts = [
    { label: "2", name: "wireless_2" },
    { label: "3", name: "wireless_3" },
    { label: "4", name: "wireless_4", emphasis: true },
    { label: "6", name: "wireless_6" },
    { label: "8", name: "wireless_8" },
    { label: f.electrodes.all, name: "wireless_all" },
  ].map((c) => ({ ...c, value: g60(c.name) }));
  const gainAll = Math.round((g60("wireless_all") - g60("wireless_2")) * 100);

  const minutes = [1, 2, 5, 10, 20];
  const personal = minutes.map((m) => R.calibration.personal[String(m)]["60"]);
  const generic = R.calibration.adapted["0"]["60"];

  const per = R.configs.wireless_4.perSubject60;
  const bar = R.chance["60"] as number;
  const above = per.filter((v) => v >= bar - 1e-9).length;
  const coin = per.filter((v) => v <= 0.5).length;
  const marks = R.people.map((p) => ({ index: Number(p.id.slice(4)) - 1, label: research.replay.people[p.label] }));

  return (
    <section id="findings" aria-labelledby="findings-heading" className={`section ${INK} border-t border-hairline`}>
      <div className="shell flex flex-col gap-[var(--rhythm)]">
        <Reveal>
          <h2 id="findings-heading" className="t-mono text-fog">
            {research.findingsEyebrow}
          </h2>
        </Reveal>

        <Finding id="window" copy={f.window} body={fill(f.window.body, pct(R.configs.wireless_4.generic.mean["300"]))}>
          <WindowChart
            xs={W}
            series={series}
            band={band}
            bandLabel={f.window.chance}
            domain={[0.45, 0.95]}
            ticks={[0.5, 0.6, 0.7, 0.8, 0.9]}
            labelled={[1, 2, 5, 10, 30, 60, 120, 300, 600]}
            xLabel={f.window.x}
            yLabel={research.axisRight}
            label={f.window.chartLabel}
          />
          <Table
            head={[f.window.x, ...series.map((s) => s.label), f.window.chance]}
            rows={W.map((w, i) => [w, ...series.map((s) => pct(s.values[i])), band[i] === null ? "" : pct(band[i] as number)])}
          />
        </Finding>

        <Finding id="electrodes" copy={f.electrodes} body={fill(f.electrodes.body, pct(g60("wireless_2")), gainAll)}>
          <ColumnChart bars={counts} domain={[0.4, 0.75]} ticks={[0.5, 0.6, 0.7]} xLabel={f.electrodes.x} yLabel={research.axisRight} label={f.electrodes.chartLabel} />
          <Table head={[f.electrodes.x, research.axisRight]} rows={counts.map((c) => [c.label, pct(c.value)])} />
          <div className="mt-12 border-t border-hairline pt-8">
            <p className="t-mono text-fog">{f.electrodes.mapLabel}</p>
            <div className="mt-6 max-w-[520px]">
              <EarMap left={R.electrodeOrder.left.slice(0, 4)} right={R.electrodeOrder.right.slice(0, 4)} leftLabel={f.electrodes.left} rightLabel={f.electrodes.right} />
            </div>
            <p className="mt-6 max-w-[56ch] text-small leading-relaxed text-fog">{f.electrodes.mapNote}</p>
          </div>
        </Finding>

        <Finding id="calibration" copy={f.calibration} body={f.calibration.body}>
          <CalibrationChart
            xs={minutes}
            series={{ id: "personal", label: f.calibration.personal, values: personal, tone: "fog" }}
            reference={{ value: generic, label: f.calibration.generic }}
            domain={DOMAIN}
            ticks={TICKS}
            xLabel={f.calibration.x}
            yLabel={research.axisRight}
            label={f.calibration.chartLabel}
          />
          <Table
            head={[f.calibration.x, f.calibration.personal, f.calibration.generic]}
            rows={minutes.map((m, i) => [m, pct(personal[i]), pct(generic)])}
          />
        </Finding>

        <Finding id="people" copy={f.people} body={fill(f.people.body, above, coin)}>
          <StripChart values={per} marks={marks} bar={bar} barLabel={f.people.bar} domain={[0.35, 0.95]} ticks={[0.4, 0.5, 0.6, 0.7, 0.8, 0.9]} label={f.people.chartLabel} ringLabel={f.people.ringed} />
          <Table head={["#", research.axisRight]} rows={per.map((v, i) => [i + 1, pct(v)])} />
        </Finding>
      </div>
    </section>
  );
}

export function ExplorerSection() {
  const e = research.explorer;
  const configs = Object.fromEntries(
    Object.entries(R.configs).map(([name, cfg]) => [
      name,
      {
        generic: { mean: cfg.generic.mean, mesdMedian: cfg.generic.mesdMedian, above60: cfg.generic.above60 },
        personal: { mean: cfg.personal.mean, mesdMedian: cfg.personal.mesdMedian, above60: cfg.personal.above60 },
      },
    ]),
  ) as ExplorerConfigs;
  return (
    <section id="explorer" aria-labelledby="explorer-heading" className={`section ${INK} border-t border-hairline`}>
      <div className="shell">
        <Reveal>
          <p className="t-mono text-fog">{e.eyebrow}</p>
        </Reveal>
        <MaskHeadline id="explorer-heading" lines={e.headlineLines} className="t-h1 mt-6" />
        <Reveal className="mt-8 max-w-[56ch]">
          <p className="text-body text-mist">{e.body}</p>
        </Reveal>
        <Reveal className="mt-16" delay={80}>
          <Explorer configs={configs} />
        </Reveal>
      </div>
    </section>
  );
}

export function Meaning() {
  const m = research.meaning;
  return (
    <section id="meaning" aria-labelledby="meaning-heading" className={`section ${PAPER}`}>
      <div className="shell">
        <Reveal>
          <p className="t-mono text-fog">{m.eyebrow}</p>
        </Reveal>
        <MaskHeadline id="meaning-heading" lines={m.headlineLines} className="t-h1 mt-6" />
        <Reveal as="ul" className="mt-16 grid grid-cols-1 gap-x-10 gap-y-12 md:grid-cols-2" staggerChildren={80}>
          {m.items.map((it, i) => (
            <li key={it.title} className="flex flex-col gap-4 border-t border-hairline pt-6">
              <p className="t-mono text-fog">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="t-h2">{it.title}</h3>
              <p className="max-w-[52ch] text-body text-mist">{fill(it.body, pct(R.configs.wireless_4.generic.mean["300"]))}</p>
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

export function Built() {
  const b = research.built;
  return (
    <section id="built" aria-labelledby="built-heading" className={`section ${INK}`}>
      <div className="shell">
        <Reveal>
          <p className="t-mono text-fog">{b.eyebrow}</p>
        </Reveal>
        <MaskHeadline id="built-heading" lines={b.headlineLines} className="t-h1 mt-6" />
        <Reveal className="mt-8 max-w-[56ch]">
          <p className="t-lead text-mist">{b.lead}</p>
        </Reveal>
        <Reveal as="ul" className="mt-16 grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3" staggerChildren={60}>
          {b.items.map((it) => (
            <li key={it.name} className="flex flex-col gap-3 border-t border-hairline pt-6">
              <h3 className="text-[1.25rem] font-medium">{it.name}</h3>
              <p className="text-body text-mist">{it.body}</p>
              <a href={`${REPO}/${it.path}`} className="research-path mt-1 text-fog transition-colors duration-[240ms] hover:text-paper" target="_blank" rel="noreferrer">
                {it.path}
              </a>
            </li>
          ))}
        </Reveal>
        <div className="mt-[var(--rhythm)]">
          <LazyConsole />
        </div>
      </div>
    </section>
  );
}

export function Method() {
  const m = research.method;
  return (
    <section id="method" aria-labelledby="method-heading" className={`section ${INK} border-t border-hairline`}>
      <div className="shell grid12">
        <div className="col-span-12 lg:col-span-4">
          <h2 id="method-heading" className="t-mono text-fog">
            {m.eyebrow}
          </h2>
          <p className="mt-8 flex flex-col gap-2 text-small">
            <a className="text-mist underline decoration-[var(--hairline)] underline-offset-4 hover:text-paper" href={`https://doi.org/${R.dataset.doi.replace(/^doi:/, "")}`} target="_blank" rel="noreferrer">
              {m.sourceLabel}
            </a>
            <a className="text-mist underline decoration-[var(--hairline)] underline-offset-4 hover:text-paper" href={R.dataset.paper} target="_blank" rel="noreferrer">
              {m.paperLabel}
            </a>
          </p>
        </div>
        <div className="col-span-12 mt-10 flex flex-col gap-8 lg:col-span-7 lg:col-start-6 lg:mt-0">
          {m.items.map((it) => (
            <div key={it.label} className="grid grid-cols-1 gap-2 border-t border-hairline pt-5 sm:grid-cols-[9rem_1fr]">
              <p className="t-mono text-fog">{it.label}</p>
              <p className="text-small leading-relaxed text-mist">{it.body}</p>
            </div>
          ))}
          <div className="border-t border-hairline pt-5">
            <p className="t-mono text-fog">{m.reproduce}</p>
            <code className="research-code mt-4">
              {m.commands.map((c) => (
                <span key={c} className="block">
                  {c}
                </span>
              ))}
            </code>
          </div>
        </div>
      </div>
    </section>
  );
}
