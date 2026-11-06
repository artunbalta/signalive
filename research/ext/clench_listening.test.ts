import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ClenchDetector } from "../../lib/sense/clench";

/**
 * The phone's clench detector (lib/sense/clench.ts), unchanged, over 18 hours
 * of 36 people sitting still and listening (clench_listening_export.py), at
 * the earbud's own 500 Hz, on the earbud montage's 4 electrodes per ear,
 * each ear against its own average. Nobody was asked to clench: every report
 * is a false alarm, or a jaw movement nobody asked for. Writes
 * research/ext/clench_listening.json.
 *
 *   npx vitest run --config research/ext/vitest.config.mts research/ext/clench_listening.test.ts
 */

const dir = join(__dirname, "data", "listening");
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as {
  fs: number;
  channels: string[];
  blocks: { person: string; block: number; samples: number }[];
};

it("stays quiet through 18 hours of people listening", () => {
  const FS = index.fs;
  const left = [0, 1, 2, 3];
  const right = [4, 5, 6, 7];
  const results: Record<string, { k: number; reports: number; kinds: Record<string, number>; kindsPerHour: Record<string, number>; hours: number; perHour: number; people: number; peopleWithAny: number; medianPersonPerHour: number; worstPersonPerHour: number; perPerson: { person: string; single: number; double: number; hold: number }[] }> = {};
  for (const k of [4, 3, 2.5]) {
    const kinds: Record<string, number> = { single: 0, double: 0, hold: 0 };
    let reports = 0;
    let seconds = 0;
    const byPerson = new Map<string, { reports: number; seconds: number; kinds: Record<string, number> }>();
    for (const b of index.blocks) {
      const buf = readFileSync(join(dir, `${b.person}_${b.block}.f32`));
      const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const n = b.samples;
      const det = new ClenchDetector({ fs: FS, left, right, k });
      const frame = new Float64Array(8);
      const events: number[] = [];
      const kindsHere: string[] = [];
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
        if (e) {
          events.push(e.time);
          kindsHere.push(e.kind);
        }
        for (const w of det.takeWithdrawals()) withdrawn.add(w.time);
      }
      let here = 0;
      const p = byPerson.get(b.person) ?? { reports: 0, seconds: 0, kinds: { single: 0, double: 0, hold: 0 } };
      events.forEach((t, j) => {
        if (withdrawn.has(t)) return;
        here++;
        kinds[kindsHere[j]!]!++;
        p.kinds[kindsHere[j]!]!++;
      });
      reports += here;
      seconds += n / FS - 1;
      p.reports += here;
      p.seconds += n / FS - 1;
      byPerson.set(b.person, p);
    }
    const people = [...byPerson.values()];
    const rates = people.map((p) => p.reports / (p.seconds / 3600)).sort((a, b) => a - b);
    results[`k${k}`] = {
      k,
      reports,
      kinds,
      kindsPerHour: Object.fromEntries(Object.entries(kinds).map(([kind, c]) => [kind, Math.round((c / (seconds / 3600)) * 100) / 100])),
      medianPersonPerHour: Math.round(((rates[17]! + rates[18]!) / 2) * 10) / 10,
      perPerson: [...byPerson.entries()].map(([person, p]) => ({ person, ...p.kinds }) as { person: string; single: number; double: number; hold: number }),
      hours: Math.round((seconds / 3600) * 100) / 100,
      perHour: Math.round((reports / (seconds / 3600)) * 100) / 100,
      people: people.length,
      peopleWithAny: people.filter((p) => p.reports > 0).length,
      worstPersonPerHour: Math.round(Math.max(...people.map((p) => p.reports / (p.seconds / 3600))) * 10) / 10,
    };
  }
  writeFileSync(
    join(__dirname, "clench_listening.json"),
    JSON.stringify({ source: "OpenNeuro ds004015 (CC0), selected blocks, 500 Hz", montage: "4 electrodes per ear, each ear against its own average", ...results }, null, 1),
  );
  expect(results.k4!.hours).toBeGreaterThan(17);
});
