import type { ReactNode } from "react";
import MaskHeadline from "@/components/ui/MaskHeadline";
import Reveal from "@/components/ui/Reveal";
import { research } from "@/lib/copy";
import results from "@/public/research/results.json";
import beyondData from "@/public/research/beyond.json";
import { CalibrationChart, ColumnChart, FrontierChart, ReliabilityChart, StripChart, WindowChart } from "./charts";
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
type Bin = { margin: number; predicted: number; predictedHandSet: number; observed: number; n: number };
type Fit = { weight: number; accuracy: number; bins: Bin[] };
type BeliefRow = { hazard: number; steady: number; switchMedian: number | null; switchMissed: number; decisionAccuracy: number };
const R = results as unknown as {
  windows: number[];
  chance: Record<string, number | null>;
  configs: Record<string, Config>;
  calibration: { personal: Record<string, Record<string, number>>; adapted: Record<string, Record<string, number>> };
  electrodeOrder: { left: string[]; right: string[] };
  people: { label: "clearest" | "typical" | "hardest"; id: string; accuracy60: number; attended: string }[];
  dataset: { doi: string; paper: string; people: number };
  neural: {
    mean: Record<string, number>;
    control: Record<string, number>;
    mesdMedian: number | null;
    splits: { seed: number; mean60: number; mean300: number; mesdMedian: number | null }[];
  };
  fusion: { handSet: number; linear: Fit; neural: Fit };
  belief: { chosenHazard: number; linear: { rows: BeliefRow[] }; learned: { rows: BeliefRow[] } };
};

const INK = "bg-ink text-paper";
const PAPER = "surface-paper bg-paper text-ink";
const REPO = "https://github.com/artunbalta/signalive/tree/main";
const DOMAIN: [number, number] = [0.45, 0.75];
const TICKS = [0.5, 0.6, 0.7];

const g60 = (name: string) => R.configs[name].generic.mean["60"];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fill = (s: string, n: string | number, m?: string | number) => s.replace("{n}", String(n)).replace("{m}", String(m ?? ""));
/** A share with one decimal below 10%, where whole percents would hide the differences. */
const pct1 = (v: number) => (v > 0 && v < 0.1 ? `${(Math.round(v * 1000) / 10).toFixed(1)}%` : pct(v));

export function ResearchHero() {
  const head = R.configs.wireless_4.generic;
  const lost = (g60("wired_4") - g60("wireless_4")) * 100;
  const st = research.stats;
  const tiles = [
    { key: "accuracy", value: pct(R.neural.mean["60"]), copy: { ...st.accuracy, sub: fill(st.accuracy.sub, pct(head.mean["60"])) } },
    { key: "wireless", value: `${lost.toFixed(1)}`, unit: research.points, copy: st.wireless },
    { key: "calibration", value: "0", unit: research.minutes, copy: st.calibration },
    { key: "speed", value: `${Math.round(R.neural.mesdMedian ?? 0)}`, unit: research.seconds, copy: { ...st.speed, sub: fill(st.speed.sub, Math.round(head.mesdMedian ?? 0)) } },
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

        <Learned band={band} />
        <Trust />
        <Belief />
      </div>
    </section>
  );
}

/** 05: the learned decoder against the linear one, and the check that it follows speech. */
function Learned({ band }: { band: (number | null)[] }) {
  const f = research.findings.learned;
  const W = R.windows;
  const series = [
    { id: "learned", label: f.series.learned, values: W.map((w) => R.neural.mean[String(w)]), tone: "paper" as const },
    { id: "linear", label: f.series.linear, values: W.map((w) => R.configs.wireless_4.generic.mean[String(w)]), tone: "mist" as const },
    { id: "control", label: f.series.control, values: W.map((w) => R.neural.control[String(w)]), tone: "fog" as const },
  ];
  const splits = R.neural.splits.map((s) => s.mean60);
  return (
    <Finding id="learned" copy={f} body={fill(f.body, pct(g60("wireless_4")), pct(R.neural.mean["60"]))}>
      <WindowChart
        xs={W}
        series={series}
        band={band}
        bandLabel={research.findings.window.chance}
        // Under the out of step line, which runs along 50%.
        bandLabelAt={0.465}
        domain={[0.4, 0.95]}
        ticks={[0.5, 0.6, 0.7, 0.8, 0.9]}
        labelled={[1, 2, 5, 10, 30, 60, 120, 300, 600]}
        xLabel={research.findings.window.x}
        yLabel={research.axisRight}
        label={f.chartLabel}
      />
      <p className="mt-8 max-w-[60ch] text-small leading-relaxed text-mist">{fill(f.check, pct(R.neural.control["60"]))}</p>
      <p className="mt-4 max-w-[60ch] text-small leading-relaxed text-fog">{fill(f.splits, pct(Math.min(...splits)), pct(Math.max(...splits)))}</p>
      <Table
        head={[research.findings.window.x, ...series.map((s) => s.label), research.findings.window.chance]}
        rows={W.map((w, i) => [w, ...series.map((s) => pct(s.values[i])), band[i] === null ? "" : pct(band[i] as number)])}
      />
    </Finding>
  );
}

/** 06: how far a decision moves the fusion, set by hand and fitted. */
function Trust() {
  const f = research.findings.trust;
  const lin = R.fusion.linear;
  const nn = R.fusion.neural;
  const w = (v: number) => v.toFixed(1);
  const top = lin.bins[lin.bins.length - 1];
  const series = [
    { id: "learned", label: fill(f.learnedFit, w(nn.weight)), tone: "paper" as const, points: nn.bins.map((b) => ({ x: b.predicted, y: b.observed, n: b.n })) },
    { id: "linear", label: fill(f.linearFit, w(lin.weight)), tone: "mist" as const, points: lin.bins.map((b) => ({ x: b.predicted, y: b.observed, n: b.n })) },
    { id: "hand", label: fill(f.linearHand, w(R.fusion.handSet)), tone: "fog" as const, dashed: true, points: lin.bins.map((b) => ({ x: b.predictedHandSet, y: b.observed, n: b.n })) },
  ];
  return (
    <Finding id="trust" copy={f} body={fill(f.body, pct(top.predictedHandSet), pct(top.observed))}>
      <ReliabilityChart
        series={series}
        domain={[0.5, 1]}
        ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]}
        xLabel={f.x}
        yLabel={research.axisRight}
        label={f.chartLabel}
        diagonalLabel={f.diagonal}
        pointLabel={f.point}
      />
      <Table
        head={[f.x, research.axisRight, f.series]}
        rows={series.flatMap((s) => s.points.map((p) => [pct(p.x), pct(p.y), s.label]))}
      />
    </Finding>
  );
}

/** 07: from single decisions to a belief that holds, and what letting go costs. */
function Belief() {
  const f = research.findings.belief;
  const h = R.belief.chosenHazard;
  const at = (rows: BeliefRow[]) => rows.find((r) => Math.abs(r.hazard - h) < 1e-9) ?? rows[0];
  const nn = at(R.belief.learned.rows);
  // Settings that come over within five minutes; the slowest ones say little but how slow.
  const line = (rows: BeliefRow[]) => rows.filter((r) => r.switchMedian !== null && r.switchMedian <= 300).map((r) => ({ x: r.switchMedian as number, y: r.steady, h: r.hazard }));
  const lines = [
    { id: "learned", label: f.learned, tone: "paper" as const, points: line(R.belief.learned.rows) },
    { id: "linear", label: f.linear, tone: "mist" as const, points: line(R.belief.linear.rows) },
  ];
  const tiles = [
    { key: "decision", value: pct(nn.decisionAccuracy), label: f.stats.decision },
    { key: "belief", value: pct(nn.steady), label: f.stats.belief },
    { key: "switch", value: `${Math.round(nn.switchMedian ?? 0)}`, unit: research.seconds, label: f.stats.switch },
  ];
  return (
    <Finding id="belief" copy={f} body={fill(f.body, pct(nn.decisionAccuracy), pct(nn.steady)).replace("{k}", String(Math.round(nn.switchMedian ?? 0)))}>
      <ul className="grid grid-cols-1 gap-x-8 gap-y-8 border-b border-hairline pb-10 sm:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.key} className="flex flex-col gap-3">
            <p className="research-stat-value research-stat-value-small">
              {t.value}
              {t.unit ? <span className="ml-2 text-[0.4em] tracking-normal text-mist">{t.unit}</span> : null}
            </p>
            <p className="text-small leading-relaxed text-mist">{t.label}</p>
          </li>
        ))}
      </ul>
      <div className="mt-10">
        <FrontierChart
          lines={lines}
          chosen={h}
          domain={[0.5, 1]}
          ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]}
          xMax={300}
          xTicks={[0, 60, 120, 180, 240, 300]}
          xLabel={f.x}
          yLabel={research.axisRight}
          label={f.chartLabel}
          pointLabel={f.point}
        />
      </div>
      <p className="mt-8 max-w-[60ch] text-small leading-relaxed text-fog">{fill(f.tradeoff, Math.round(h * 100))}</p>
      <Table
        head={[f.table.hazard, f.table.learnedSteady, f.table.learnedSwitch, f.table.linearSteady, f.table.linearSwitch]}
        rows={R.belief.learned.rows.map((r, i) => {
          const l = R.belief.linear.rows[i];
          const s = (v: number | null) => (v === null ? f.table.beyond : `${Math.round(v)} s`);
          return [`${Math.round(r.hazard * 1000) / 10}%`, pct(r.steady), s(r.switchMedian), pct(l.steady), s(l.switchMedian)];
        })}
      />
    </Finding>
  );
}

type ClenchData = {
  threshold: number;
  datasets: { key: "around" | "headband" | "scalp" | "listening"; people: number; fs: number; caught: number | null; peopleAll: number | null; falsePerHour: number | null; hours?: number }[];
  listening: { perHour: number; kindsPerHour: { single: number; double: number; hold: number }; medianPerson: number; worstPerson: number };
  movement: { key: keyof typeof research.beyond.clench.movements; events: number; share: number; doubles: number }[];
};
type Curve = { mean: Record<string, number>; control60: number | null; mesd: number | null };
type EarSystem = { linear: { mean: Record<string, number> }; learned: { mean: Record<string, number> } };
const B = beyondData as unknown as {
  clench?: ClenchData;
  heldOut?: { standard?: Curve; content?: Curve; study?: Curve };
  inEar?: Partial<Record<"inear" | "aroundear" | "both" | "scalp", EarSystem>>;
};

/**
 * Before the hardware: the phone's code on other people's public recordings.
 * Each finding appears once research/ext/export_page.py has its numbers.
 */
export function Beyond() {
  const b = research.beyond;
  if (!B.clench && !B.heldOut && !B.inEar) return null;
  return (
    <section id="beyond" aria-labelledby="beyond-heading" className={`section ${INK} border-t border-hairline`}>
      <div className="shell flex flex-col gap-[var(--rhythm)]">
        <div className="grid12">
          <div className="col-span-12 lg:col-span-8">
            <Reveal>
              <h2 id="beyond-heading" className="t-mono text-fog">
                {b.eyebrow}
              </h2>
            </Reveal>
            <MaskHeadline as="p" lines={b.headlineLines} className="t-h2 mt-5" />
            <Reveal className="mt-6">
              <p className="max-w-[60ch] text-body text-mist">{b.body}</p>
            </Reveal>
          </div>
        </div>
        {B.heldOut?.content && B.heldOut.standard ? <HeldOut data={B.heldOut} /> : null}
        {B.inEar ? <InEar data={B.inEar} /> : null}
        {B.clench ? <Clench data={B.clench} /> : null}
      </div>
    </section>
  );
}

/** 08: the learned decoder held out by story content and by source study, not only by person. */
function HeldOut({ data }: { data: NonNullable<typeof B.heldOut> }) {
  const f = research.beyond.heldOut;
  const W = R.windows;
  const curve = (c: Curve | undefined) => W.map((w) => c?.mean[String(w)] ?? NaN);
  // The series the finding is about comes first: the chart labels its end.
  const series = [
    { id: "content", label: f.series.content, values: curve(data.content), tone: "paper" as const },
    { id: "standard", label: f.series.standard, values: curve(data.standard), tone: "mist" as const },
    ...(data.study ? [{ id: "study", label: f.series.study, values: curve(data.study), tone: "fog" as const }] : []),
  ];
  const band = W.map((w) => R.chance[String(w)] ?? null);
  const at60 = (c: Curve | undefined) => (c ? pct(c.mean["60"]) : "");
  const body = f.body.replace("{std}", at60(data.standard)).replace("{content}", at60(data.content)).replace("{study}", at60(data.study));
  return (
    <Finding id="held-out" copy={f} body={body}>
      <WindowChart
        xs={W}
        series={series}
        band={band}
        bandLabel={f.chance}
        domain={[0.45, 0.95]}
        ticks={[0.5, 0.6, 0.7, 0.8, 0.9]}
        labelled={[1, 2, 5, 10, 30, 60, 120, 300, 600]}
        xLabel={f.x}
        yLabel={research.axisRight}
        label={f.chartLabel}
      />
      <p className="mt-8 max-w-[60ch] text-small leading-relaxed text-mist">{f.decides.replace("{ctl}", data.content?.control60 == null ? "" : pct(data.content.control60))}</p>
      <Table head={[f.x, ...series.map((x) => x.label)]} rows={W.map((w, i) => [w, ...series.map((x) => (Number.isFinite(x.values[i]) ? pct(x.values[i]) : ""))])} />
    </Finding>
  );
}

/** 09: the same decoders on dry electrodes in the ear, wet ones around it, and the scalp, at the same moments. */
function InEar({ data }: { data: NonNullable<typeof B.inEar> }) {
  const f = research.beyond.inEar;
  const keys = (["inear", "aroundear", "both", "scalp"] as const).filter((k) => data[k]);
  const bars = keys.map((k) => ({ label: f.systems[k], value: data[k]!.learned.mean["60"], emphasis: k === "aroundear", labelled: true }));
  const v = (k: (typeof keys)[number], dec: "linear" | "learned", w: string) => {
    const x = data[k]?.[dec].mean[w];
    return typeof x === "number" ? pct(x) : "";
  };
  const body = f.body.replace("{around}", v("aroundear", "learned", "60")).replace("{inear}", v("inear", "learned", "60"));
  return (
    <Finding id="in-ear" copy={f} body={body}>
      <ColumnChart bars={bars} domain={[0.4, 0.9]} ticks={[0.5, 0.6, 0.7, 0.8]} xLabel={f.x} yLabel={f.y} label={f.chartLabel} />
      <p className="mt-8 max-w-[60ch] text-small leading-relaxed text-mist">{f.decides}</p>
      <Table head={[f.table.system, f.table.linear, f.table.learned, f.table.learned5]} rows={keys.map((k) => [f.systems[k], v(k, "linear", "60"), v(k, "learned", "60"), v(k, "learned", "300")])} />
    </Finding>
  );
}

/** 10: the clench detector on real clenches and on everything that resembles one. */
function Clench({ data }: { data: ClenchData }) {
  const f = research.beyond.clench;
  const around = data.datasets.find((d) => d.key === "around");
  const swallow = data.movement.find((m) => m.key === "swallow");
  const k = data.listening.kindsPerHour;
  const bars = data.movement.map((m) => ({ label: f.movements[m.key], value: m.share, emphasis: m.key === "swallow" }));
  const rate = (v: number) => (v < 1 ? v.toFixed(2) : v.toFixed(1));
  const tiles = [
    { key: "caught", value: around?.caught == null ? "" : pct(around.caught), label: f.stats.caught },
    { key: "swallow", value: swallow ? pct(swallow.share) : "", label: f.stats.swallow },
    { key: "doubles", value: rate(k.double), label: f.stats.doubles },
  ];
  return (
    <Finding id="clench" copy={f} body={fill(f.body, around?.caught == null ? "" : pct(around.caught))}>
      <ul className="grid grid-cols-1 gap-x-8 gap-y-8 border-b border-hairline pb-10 sm:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.key} className="flex flex-col gap-3">
            <p className="research-stat-value research-stat-value-small">{t.value}</p>
            <p className="text-small leading-relaxed text-mist">{t.label}</p>
          </li>
        ))}
      </ul>
      <figure className="mt-10" aria-label={f.chartLabel}>
        <p className="t-mono text-fog">{f.y}</p>
        <ul className="mt-4 flex flex-col gap-3">
          {bars.map((b) => (
            <li key={b.label} className="grid grid-cols-[7.5rem_1fr_3.25rem] items-center gap-3 sm:grid-cols-[10rem_1fr_4rem] sm:gap-4">
              <span className={`text-small ${b.emphasis ? "text-paper" : "text-mist"}`}>{b.label}</span>
              <span className="relative h-2 rounded-full bg-[color-mix(in_srgb,var(--color-paper)_8%,transparent)]" aria-hidden="true">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${Math.max(1, (b.value / 0.6) * 100)}%`, background: b.emphasis ? "var(--color-paper)" : "var(--color-fog)" }}
                />
              </span>
              <span className={`t-mono text-right ${b.emphasis ? "text-paper" : "text-mist"}`}>{pct1(b.value)}</span>
            </li>
          ))}
        </ul>
        <figcaption className="mt-4 max-w-[60ch] text-small leading-relaxed text-fog">{f.movementsNote}</figcaption>
      </figure>
      <p className="mt-8 max-w-[60ch] text-small leading-relaxed text-mist">{fill(f.decides, rate(k.double), rate(k.single + k.hold))}</p>
      <Table
        head={[f.table.recording, f.table.people, f.table.caught, f.table.falsePerHour]}
        rows={data.datasets.map((d) => [
          f.datasets[d.key],
          d.people,
          d.caught === null ? "" : d.key === "scalp" ? fill(f.blocks, pct(d.caught)) : pct(d.caught),
          d.falsePerHour === null ? "" : fill(f.perHour, rate(d.falsePerHour)),
        ])}
      />
    </Finding>
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
