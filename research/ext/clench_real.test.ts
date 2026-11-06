import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ClenchDetector, type ClenchEvent } from "../../lib/sense/clench";

/**
 * The clench detector the phone runs (lib/sense/clench.ts), unchanged, on
 * real recordings around the ear (clench_export.py): ten cued 3 s clenches
 * per person, and stretches of blinking, eye movements, rest and heartbeat
 * in which every report is false. Two ways of referencing the electrodes:
 * as recorded, and each ear against its own average, as an earbud with its
 * reference in the same ear would see it. Writes research/ext/clench_real.json.
 *
 *   npx vitest run --config research/ext/vitest.config.mts research/ext/clench_real.test.ts
 */

const dir = join(__dirname, "data", "park", "export");
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as {
  fs: number;
  channels: string[];
  clenchCues: number[];
  clenchSeconds: number;
  tasks: Record<string, { people: number; channels: number; samples: number }>;
};
const FS = index.fs;

function task(name: string) {
  const t = index.tasks[name]!;
  const buf = readFileSync(join(dir, `${name}.f32`));
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from({ length: t.people }, (_, p) => Array.from({ length: t.channels }, (_, c) => all.subarray((p * t.channels + c) * t.samples, (p * t.channels + c + 1) * t.samples)));
}

type Montage = "recorded" | "ownEar";
const LEFT = Array.from({ length: 9 }, (_, i) => i);
const RIGHT = Array.from({ length: 9 }, (_, i) => 9 + i);

/** Every event the detector reports, and every one it takes back, with the time it said so. */
function run(chans: Float32Array[], montage: Montage, k?: number, levels?: (t: number, l: [number, number]) => void) {
  const det = new ClenchDetector({ fs: FS, left: LEFT, right: RIGHT, k });
  const n = chans[0]!.length;
  const frame = new Float64Array(18);
  const events: { e: ClenchEvent; at: number }[] = [];
  const withdrawn: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 18; c++) frame[c] = chans[c]![i]!;
    if (montage === "ownEar") {
      for (const side of [LEFT, RIGHT]) {
        let m = 0;
        for (const c of side) m += frame[c]!;
        m /= side.length;
        for (const c of side) frame[c] -= m;
      }
    }
    const e = det.push(frame);
    if (e) events.push({ e, at: i / FS });
    levels?.(i / FS, det.levels);
    for (const w of det.takeWithdrawals()) withdrawn.push(w.time);
  }
  // What stands: reports chewing did not take back.
  return events.filter((x) => !withdrawn.includes(x.e.time));
}

function median(v: number[]) {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

it("the phone's clench detector on real clenches, blinks, eye movements, rest and heartbeat around the ear", () => {
  const out: Record<string, unknown> = { source: "Park, Kim, Choi, Hwang, Figshare 10.6084/m9.figshare.23523588 v3, CC BY 4.0", fs: FS };
  const clench = task("clench");
  const others = ["blink", "eyes", "alpha", "ecg"].map((name) => ({ name, data: task(name) }));
  for (const montage of ["recorded", "ownEar"] as Montage[]) {
    const perPerson: { caught: number; holds: number; other: number; false: number; latency: number[] }[] = [];
    for (const chans of clench) {
      const events = run(chans, montage);
      const used = new Set<number>();
      let caught = 0;
      let holds = 0;
      let other = 0;
      const latency: number[] = [];
      for (const cue of index.clenchCues) {
        const t0 = cue / FS;
        const i = events.findIndex((x, j) => !used.has(j) && x.at >= t0 + 0.15 && x.at <= t0 + index.clenchSeconds + 0.5);
        if (i < 0) continue;
        used.add(i);
        caught++;
        if (events[i]!.e.kind === "hold") holds++;
        else other++;
        latency.push(events[i]!.at - t0);
      }
      perPerson.push({ caught, holds, other, false: events.length - used.size, latency });
    }
    const cues = index.clenchCues.length * clench.length;
    const falseIn: Record<string, { reports: number; doubles: number; minutes: number; perHour: number }> = {};
    for (const { name, data } of others) {
      let reports = 0;
      let doubles = 0;
      let seconds = 0;
      for (const chans of data) {
        // The first second sets the detector's floor; nothing is reported in it.
        const ev = run(chans, montage);
        reports += ev.length;
        doubles += ev.filter((x) => x.e.kind === "double").length;
        seconds += chans[0]!.length / FS - 1;
      }
      falseIn[name] = { reports, doubles, minutes: Math.round(seconds / 6) / 10, perHour: Math.round((reports / (seconds / 3600)) * 10) / 10 };
    }
    const caught = perPerson.reduce((a, p) => a + p.caught, 0);
    out[montage] = {
      cues,
      caught,
      caughtShare: Math.round((caught / cues) * 1000) / 1000,
      reportedAsHold: perPerson.reduce((a, p) => a + p.holds, 0),
      reportedAsOther: perPerson.reduce((a, p) => a + p.other, 0),
      falseBetweenClenches: perPerson.reduce((a, p) => a + p.false, 0),
      cueToReportMedianS: median(perPerson.flatMap((p) => p.latency)),
      perPersonCaught: perPerson.map((p) => p.caught),
      falseIn,
    };
  }
  writeFileSync(join(__dirname, "clench_real.json"), JSON.stringify(out, null, 1));
  expect(out.recorded).toBeTruthy();
});

/** Cued clenches caught, and reports between them, for one person at one threshold; cues from `from` on. */
function scoreClench(chans: Float32Array[], montage: Montage, k: number | undefined, from = 0) {
  const events = run(chans, montage, k);
  const used = new Set<number>();
  let caught = 0;
  const cues = index.clenchCues.slice(from);
  for (const cue of cues) {
    const t0 = cue / FS;
    const i = events.findIndex((x, j) => !used.has(j) && x.at >= t0 + 0.15 && x.at <= t0 + index.clenchSeconds + 0.5);
    if (i < 0) continue;
    used.add(i);
    caught++;
  }
  const start = from ? index.clenchCues[from]! / FS - 1 : 0;
  const strays = events.filter((x, j) => !used.has(j) && x.at >= start).length;
  return { caught, cues: cues.length, strays };
}

/**
 * What a person's own clench says about them: the detector's level on the
 * weaker ear (RMS over its background) during each of the first clenches,
 * the median over them. A threshold at half of it, kept between 2.1 (just
 * over the detector's release level) and 4, is what a ten second setup
 * ("clench three times") would set.
 */
function personalK(chans: Float32Array[], montage: Montage, cues: number[]): { level: number; k: number } {
  const peaks: number[] = [];
  let cur = 0;
  let ci = 0;
  run(chans, montage, undefined, (t, [l, r]) => {
    const cue = cues[ci];
    if (cue === undefined) return;
    const t0 = cue / FS;
    if (t >= t0 + 0.3 && t <= t0 + index.clenchSeconds) cur = Math.max(cur, Math.min(l, r));
    if (t > t0 + index.clenchSeconds) {
      peaks.push(cur);
      cur = 0;
      ci++;
    }
  });
  const level = median(peaks) ?? 4;
  return { level, k: Math.max(2.1, Math.min(4, level / 2)) };
}

it("the same detector at other thresholds, and with each person's own from three clenches", () => {
  const clench = task("clench");
  const others = ["blink", "eyes", "alpha", "ecg"].map((name) => ({ name, data: task(name) }));
  const montage: Montage = "ownEar";
  const sweep = [2.1, 2.25, 2.5, 2.75, 3, 3.5, 4].map((k) => {
    let caught = 0;
    let cues = 0;
    let strays = 0;
    for (const chans of clench) {
      const s = scoreClench(chans, montage, k);
      caught += s.caught;
      cues += s.cues;
      strays += s.strays;
    }
    let reports = 0;
    let seconds = 0;
    for (const { data } of others) {
      for (const chans of data) {
        reports += run(chans, montage, k).length;
        seconds += chans[0]!.length / FS - 1;
      }
    }
    const perPerson = clench.map((chans) => scoreClench(chans, montage, k).caught);
    return { k, caughtShare: Math.round((caught / cues) * 1000) / 1000, peopleAt9of10: perPerson.filter((c) => c >= 9).length, strays, falsePerHour: Math.round((reports / (seconds / 3600)) * 10) / 10 };
  });

  // Personal: the first three cues set k; the other seven, and every other recording of the same person, test it.
  const personal = clench.map((chans, p) => {
    const { level, k } = personalK(chans, montage, index.clenchCues.slice(0, 3));
    const s = scoreClench(chans, montage, k, 3);
    let reports = 0;
    let seconds = 0;
    for (const { data } of others) {
      reports += run(data[p]!, montage, k).length;
      seconds += data[p]![0]!.length / FS - 1;
    }
    return { person: p + 1, level: Math.round(level * 100) / 100, k: Math.round(k * 100) / 100, caught: s.caught, of: s.cues, strays: s.strays, falseReports: reports, falseMinutes: Math.round(seconds / 6) / 10 };
  });
  const caught = personal.reduce((a, p) => a + p.caught, 0);
  const of = personal.reduce((a, p) => a + p.of, 0);
  const falseReports = personal.reduce((a, p) => a + p.falseReports, 0);
  const falseHours = personal.reduce((a, p) => a + p.falseMinutes, 0) / 60;
  const path = join(__dirname, "clench_real.json");
  const out = JSON.parse(readFileSync(path, "utf8"));
  out.sweep = { montage, rows: sweep };
  out.personal = {
    montage,
    rule: "k = half the median level of the weaker ear during the first 3 cued clenches, kept between 2.1 and 4; tested on the other 7 cues and on every other recording of the same person",
    caughtShare: Math.round((caught / of) * 1000) / 1000,
    caught,
    of,
    peopleAllCaught: personal.filter((p) => p.caught === p.of).length,
    falsePerHour: Math.round((falseReports / falseHours) * 10) / 10,
    falseReports,
    falseHours: Math.round(falseHours * 100) / 100,
    people: personal,
  };
  writeFileSync(path, JSON.stringify(out, null, 1));
  expect(sweep.length).toBe(7);
});

/** The weaker ear's level through the first cued clenches and the rests between them, for a personal threshold. */
function calibration(chans: Float32Array[], montage: Montage, cues: number[]) {
  const on: number[] = [];
  const off: number[] = [];
  const peaks: number[] = [];
  let peak = 0;
  let ci = 0;
  run(chans, montage, undefined, (t, [l, r]) => {
    const cue = cues[ci];
    if (cue === undefined) return;
    const t0 = cue / FS;
    const m = Math.min(l, r);
    if (t >= t0 + 0.3 && t <= t0 + index.clenchSeconds) {
      on.push(m);
      peak = Math.max(peak, m);
    } else if (t >= t0 + index.clenchSeconds + 0.5 && t <= t0 + 2 * index.clenchSeconds - 0.5) off.push(m);
    if (t > t0 + 2 * index.clenchSeconds - 0.5) {
      peaks.push(peak);
      peak = 0;
      ci++;
    }
  });
  const q = (v: number[], f: number) => {
    const a = [...v].sort((x, y) => x - y);
    return a.length ? a[Math.min(a.length - 1, Math.floor(f * (a.length - 1)))]! : NaN;
  };
  return { peak: median(peaks) ?? NaN, onMedian: q(on, 0.5), offHigh: q(off, 0.99) };
}

const clamp = (k: number) => Math.max(2.1, Math.min(4, Number.isFinite(k) ? k : 4));
const RULES: Record<string, (c: ReturnType<typeof calibration>) => number> = {
  halfPeak: (c) => clamp(c.peak / 2),
  halfMedian: (c) => clamp(c.onMedian / 2),
  between: (c) => clamp(Math.sqrt(Math.max(c.offHigh, 1) * c.onMedian)),
};

it("a personal threshold chosen by rule on half the people, judged on the other half", () => {
  const clench = task("clench");
  const others = ["blink", "eyes", "alpha", "ecg"].map((name) => ({ name, data: task(name) }));
  const montage: Montage = "ownEar";
  const cal = clench.map((chans) => calibration(chans, montage, index.clenchCues.slice(0, 3)));
  const judge = (rule: string, people: number[]) => {
    let caught = 0;
    let of = 0;
    let reports = 0;
    let seconds = 0;
    const ks: number[] = [];
    for (const p of people) {
      const k = RULES[rule]!(cal[p]!);
      ks.push(Math.round(k * 100) / 100);
      const s = scoreClench(clench[p]!, montage, k, 3);
      caught += s.caught;
      of += s.cues;
      for (const { data } of others) {
        reports += run(data[p]!, montage, k).length;
        seconds += data[p]![0]!.length / FS - 1;
      }
    }
    return { rule, caughtShare: Math.round((caught / of) * 1000) / 1000, caught, of, falsePerHour: Math.round((reports / (seconds / 3600)) * 10) / 10, reports, ks };
  };
  const odd = clench.map((_, p) => p).filter((p) => p % 2 === 0);
  const even = clench.map((_, p) => p).filter((p) => p % 2 === 1);
  const choosing = Object.keys(RULES).map((r) => judge(r, odd));
  // Chosen on the first half: most clenches caught at no more than 2 false an hour, else the fewest false.
  const ok = choosing.filter((r) => r.falsePerHour <= 2);
  const chosen = (ok.length ? ok.sort((a, b) => b.caughtShare - a.caughtShare) : [...choosing].sort((a, b) => a.falsePerHour - b.falsePerHour))[0]!.rule;
  const judged = judge(chosen, even);
  const all = Object.keys(RULES).map((r) => judge(r, clench.map((_, p) => p)));
  const path = join(__dirname, "clench_real.json");
  const out = JSON.parse(readFileSync(path, "utf8"));
  out.personalRules = {
    montage,
    calibration: "the first 3 cued clenches and the rests after them; judged on the other 7 cues and every other recording of the same person",
    rules: {
      halfPeak: "half the median of each calibration clench's peak level on the weaker ear",
      halfMedian: "half the median level on the weaker ear during the calibration clenches",
      between: "the geometric mean of that median and the 99th percentile of the level in the rests between them",
    },
    choosingOn: "people 1, 3, 5, ... 15",
    choosing,
    chosen,
    judgedOn: "people 2, 4, ... 14",
    judged,
    allPeople: all,
  };
  writeFileSync(path, JSON.stringify(out, null, 1));
  expect(judged.of).toBeGreaterThan(0);
});
