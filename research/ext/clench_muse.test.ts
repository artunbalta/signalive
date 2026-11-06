import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ClenchDetector, type ClenchEvent } from "../../lib/sense/clench";

/**
 * The phone's clench detector (lib/sense/clench.ts), unchanged, on a $250
 * consumer headband (Muse 2): one electrode behind each ear (TP9, TP10) at
 * 256 Hz, 20 cued clenches 3 s apart between two minutes of rest, and the
 * same session's blinks and head movements (muse_export.py). Writes
 * research/ext/clench_muse.json.
 *
 *   npx vitest run --config research/ext/vitest.config.mts research/ext/clench_muse.test.ts
 */

const dir = join(__dirname, "data", "muse", "export");
type Row = { person: string; fs: number; samples: number; cues: number[]; taskStart: number | null; taskEnd: number | null };
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { fs: number; tasks: Record<string, Row[]> };

function run(task: string, row: Row, k?: number) {
  const buf = readFileSync(join(dir, task, `${row.person}.f32`));
  const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = row.samples;
  const det = new ClenchDetector({ fs: row.fs, left: [0], right: [1], k });
  const frame = new Float64Array(2);
  const events: { e: ClenchEvent; at: number }[] = [];
  const withdrawn = new Set<number>();
  for (let i = 0; i < n; i++) {
    frame[0] = x[i]!;
    frame[1] = x[n + i]!;
    const e = det.push(frame);
    if (e) events.push({ e, at: i / row.fs });
    for (const w of det.takeWithdrawals()) withdrawn.add(w.time);
  }
  return { events: events.filter((v) => !withdrawn.has(v.e.time)), seconds: n / row.fs };
}

it("the phone's clench detector on a consumer headband's electrodes behind the ears", () => {
  const out: Record<string, unknown> = { source: "Lee and Ahn, Figshare 10.6084/m9.figshare.30162868 (CC BY 4.0), Muse 2 TP9 and TP10", fs: index.fs };
  for (const k of [4, 3]) {
    let cues = 0;
    let caught = 0;
    let restReports = 0;
    let restSeconds = 0;
    const kinds: Record<string, number> = { single: 0, double: 0, hold: 0 };
    const perPerson: number[] = [];
    for (const row of index.tasks.BT!) {
      const { events, seconds } = run("BT", row, k);
      const used = new Set<number>();
      let here = 0;
      for (const cue of row.cues) {
        const i = events.findIndex((v, j) => !used.has(j) && v.at >= cue + 0.15 && v.at <= cue + 2.9);
        if (i < 0) continue;
        used.add(i);
        here++;
        kinds[events[i]!.e.kind]!++;
      }
      cues += row.cues.length;
      caught += here;
      perPerson.push(Math.round((here / Math.max(1, row.cues.length)) * 100) / 100);
      // Reports in the two rests, the first second excepted.
      const s0 = row.taskStart ?? 60;
      const s1 = row.taskEnd ?? seconds - 60;
      restReports += events.filter((v) => v.at >= 1 && (v.at < s0 || v.at > s1 + 3)).length;
      restSeconds += s0 - 1 + Math.max(0, seconds - s1 - 3);
    }
    const falseIn: Record<string, { reports: number; doubles: number; minutes: number; perHour: number; doublesPerHour: number }> = {};
    for (const task of ["EB", "MVO", "MVC"]) {
      let reports = 0;
      let doubles = 0;
      let seconds = 0;
      for (const row of index.tasks[task]!) {
        const r = run(task, row, k);
        reports += r.events.length;
        doubles += r.events.filter((v) => v.e.kind === "double").length;
        seconds += r.seconds - 1;
      }
      const h = seconds / 3600;
      falseIn[task] = { reports, doubles, minutes: Math.round(seconds / 6) / 10, perHour: Math.round((reports / h) * 10) / 10, doublesPerHour: Math.round((doubles / h) * 10) / 10 };
    }
    out[`k${k}`] = {
      people: index.tasks.BT!.length,
      cues,
      caught,
      caughtShare: Math.round((caught / cues) * 1000) / 1000,
      kinds,
      peopleAbove90: perPerson.filter((p) => p >= 0.9).length,
      perPerson,
      restReports,
      restPerHour: Math.round((restReports / (restSeconds / 3600)) * 10) / 10,
      falseIn,
    };
  }
  writeFileSync(join(__dirname, "clench_muse.json"), JSON.stringify(out, null, 1));
  expect(out.k4).toBeTruthy();
});
