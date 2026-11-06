import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ClenchDetector, type ClenchEvent } from "../../lib/sense/clench";

/**
 * The phone's clench detector (lib/sense/clench.ts), unchanged, through two
 * hours per person of labelled movements (physiomotion_export.py), on the
 * four channels nearest each ear, each side against its own average, at
 * 1000 Hz. For every kind of labelled event: how often the detector reports
 * a gesture during it (or within 0.7 s after, the time a report can trail
 * the jaw), by kind. "chew" is the dataset's cued molar clenching, so there a
 * report is a hit; everywhere else it is false. Writes
 * research/ext/clench_physiomotion.json.
 *
 *   npx vitest run --config research/ext/vitest.config.mts research/ext/clench_physiomotion.test.ts
 */

const dir = join(__dirname, "data", "physiomotion", "export");
type Ev = { label: string; start: number; stop: number };
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { channels: string[]; runs: { name: string; fs: number; samples: number; events: Ev[] }[] };
const TRAIL_S = 0.7;

function detect(name: string, fs: number, n: number) {
  const buf = readFileSync(join(dir, `${name}.f32`));
  const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const left = [0, 1, 2, 3];
  const right = [4, 5, 6, 7];
  const det = new ClenchDetector({ fs, left, right });
  const frame = new Float64Array(8);
  const events: { e: ClenchEvent; at: number }[] = [];
  const withdrawn = new Set<number>();
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 8; c++) frame[c] = x[c * n + i]!;
    for (const side of [left, right]) {
      let m = 0;
      for (const c of side) m += frame[c]!;
      m /= side.length;
      for (const c of side) frame[c] -= m;
    }
    const e = det.push(frame);
    if (e) events.push({ e, at: i / fs });
    for (const w of det.takeWithdrawals()) withdrawn.add(w.time);
  }
  return events.filter((v) => !withdrawn.has(v.e.time));
}

it("what sets the clench detector off, movement by movement", () => {
  const byLabel: Record<string, { events: number; withReport: number; reports: number; doubles: number; seconds: number }> = {};
  let unlabelledReports = 0;
  let unlabelledDoubles = 0;
  let unlabelledSeconds = 0;
  for (const run of index.runs) {
    const reports = detect(run.name, run.fs, run.samples);
    const claimed = new Set<number>();
    for (const ev of run.events) {
      const s = (byLabel[ev.label] ??= { events: 0, withReport: 0, reports: 0, doubles: 0, seconds: 0 });
      s.events++;
      s.seconds += ev.stop - ev.start;
      const inside = reports.map((r, i) => ({ r, i })).filter(({ r }) => r.at >= ev.start && r.at <= ev.stop + TRAIL_S);
      if (inside.length) s.withReport++;
      s.reports += inside.length;
      s.doubles += inside.filter(({ r }) => r.e.kind === "double").length;
      for (const { i } of inside) claimed.add(i);
    }
    // Outside every labelled event: the baseline, by the time it covers.
    const covered = run.events.reduce((a, ev) => a + (ev.stop + TRAIL_S - ev.start), 0);
    unlabelledSeconds += Math.max(0, run.samples / run.fs - 1 - covered);
    const free = reports.filter((_, i) => !claimed.has(i));
    unlabelledReports += free.length;
    unlabelledDoubles += free.filter((r) => r.e.kind === "double").length;
  }
  const rows = Object.entries(byLabel)
    .map(([label, s]) => ({
      label,
      events: s.events,
      shareWithReport: Math.round((s.withReport / s.events) * 1000) / 1000,
      reports: s.reports,
      doubles: s.doubles,
      minutes: Math.round(s.seconds / 6) / 10,
    }))
    .sort((a, b) => b.events - a.events);
  const people = new Set(index.runs.map((r) => r.name.split("_")[0])).size;
  writeFileSync(
    join(__dirname, "clench_physiomotion.json"),
    JSON.stringify(
      {
        source: "PhysioMotion Artifact, OpenNeuro ds006386 (CC0), FT7 T7 TP7 P7 and FT8 T8 TP8 P8, 1000 Hz",
        people,
        runs: index.runs.length,
        rule: "a report during an event or within 0.7 s after it; 'chew' is cued molar clenching, so there it is a hit",
        byLabel: rows,
        unlabelled: {
          reports: unlabelledReports,
          doubles: unlabelledDoubles,
          hours: Math.round((unlabelledSeconds / 3600) * 100) / 100,
          perHour: Math.round((unlabelledReports / (unlabelledSeconds / 3600)) * 10) / 10,
        },
      },
      null,
      1,
    ),
  );
  expect(rows.length).toBeGreaterThan(3);
});
