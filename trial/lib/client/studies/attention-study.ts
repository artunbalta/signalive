/**
 * The attention study (research/NEXT.md, experiment 2): can the earbuds
 * follow a switch? Two voices play at once, one on each side; a cue says
 * which to follow and moves to the other every 30 to 90 seconds. The phone
 * plays the voices, so it knows each one's speech envelope exactly, and the
 * decoder's 10 second decisions are scored against the cue. This file is the
 * part without a device or a screen: the plan of cues, the envelope of a
 * voice, and the score. attention-runner.ts plays the plan.
 *
 * Two numbers matter. How often a decision names the cued voice, by how
 * long since the cue last moved; and how long the running belief takes to
 * come over to the voice the cue moved to (a switch is followed when the
 * belief first favours the new voice, missed when the cue moves again
 * first). The research page predicts both from recordings in which attention
 * never moved; this measures them where it does.
 */

import { fuseAttention } from "@sense/fusion";

/** The decoder's decision window, s. */
export const DECISION_S = 10;
/** Envelope rate, Hz: the decoder's. */
export const ENV_RATE = 64;

/**
 * Where the person faces during a cue (research/NEXT.md, experiment 3): the
 * voice they follow, the other one (as at a dinner table, looking at one
 * person while following another), or straight ahead between them.
 */
export type HeadCondition = "toward" | "away" | "ahead";
export const HEAD_CONDITIONS: readonly HeadCondition[] = ["toward", "away", "ahead"];

export interface CueSegment {
  /** ms from the start of the study. */
  from: number;
  to: number;
  /** 0 the left voice, 1 the right one. */
  talker: number;
  /** Where to face, when the study asks. */
  head?: HeadCondition;
}

export interface SwitchPlan {
  cues: CueSegment[];
  durationMs: number;
  seed: number;
}

export interface SwitchPlanOptions {
  minutes: number;
  /** How long attention stays on one voice, s. NEXT.md: 30 to 90. */
  minHoldS?: number;
  maxHoldS?: number;
  /** The voice the first cue names; random by default. */
  firstTalker?: number;
  /** Nothing is cued before this, ms: the decoder's scale settles on the first seconds of signal. */
  leadMs?: number;
  /** Also say where to face, each cue in turn toward, away and ahead (shuffled per round). */
  head?: boolean;
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cues that alternate between the two voices, each held for a random 30 to 90 s. */
export function planSwitches(opts: SwitchPlanOptions): SwitchPlan {
  const seed = (opts.seed ?? Date.now()) >>> 0;
  const rand = mulberry32(seed);
  const minHold = (opts.minHoldS ?? 30) * 1000;
  const maxHold = Math.max(minHold, (opts.maxHoldS ?? 90) * 1000);
  const durationMs = Math.round(opts.minutes * 60_000);
  if (!(durationMs > 0)) throw new RangeError("studies: minutes must be positive");
  let talker = opts.firstTalker ?? (rand() < 0.5 ? 0 : 1);
  let t = opts.leadMs ?? 0;
  const cues: CueSegment[] = [];
  let round: HeadCondition[] = [];
  while (t < durationMs) {
    const to = Math.min(durationMs, Math.round(t + minHold + rand() * (maxHold - minHold)));
    const cue: CueSegment = { from: Math.round(t), to, talker };
    if (opts.head) {
      if (!round.length) round = shuffled(HEAD_CONDITIONS, rand);
      cue.head = round.shift();
    }
    cues.push(cue);
    t = to;
    talker = 1 - talker;
  }
  return { cues, durationMs, seed };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Degrees the head should point for a cue, left negative, given the voices' directions. */
export function headTarget(cue: CueSegment, azimuths: readonly number[]): number | null {
  if (!cue.head) return null;
  if (cue.head === "ahead") return 0;
  const toward = azimuths[cue.talker] ?? 0;
  return cue.head === "toward" ? toward : azimuths[1 - cue.talker] ?? -toward;
}

/** The cued voice at a moment, or null before the first cue. */
export function cuedAt(plan: SwitchPlan, ms: number): CueSegment | null {
  for (const c of plan.cues) if (ms >= c.from && ms < c.to) return c;
  return null;
}

/**
 * A voice's speech envelope at 64 Hz: the RMS of each 1/64 s of its samples,
 * linear amplitude as the earbuds' AUDIO_ENV frames carry it (any scale: the
 * decoder band passes it and scales it by its own running spread).
 */
export function envelope64(samples: Float32Array, rate: number): Float32Array {
  const n = Math.floor((samples.length * ENV_RATE) / rate);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.floor((k * rate) / ENV_RATE);
    const b = Math.max(a + 1, Math.floor(((k + 1) * rate) / ENV_RATE));
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i]! * samples[i]!;
    out[k] = Math.sqrt(sum / (b - a));
  }
  return out;
}

export interface StudyDecision {
  /** The window, ms from the start of the study. */
  startMs: number;
  endMs: number;
  talker: number;
  margin: number;
  belief: number[];
  /** Head yaw at the decision, degrees, right positive; null without a motion sensor. */
  yawDeg?: number | null;
  /** Head and EEG together, per voice. */
  posterior?: number[];
}

export interface HeadScore {
  decisions: number;
  /** The EEG's decision named the cued voice. */
  eeg: number | null;
  /** The head pointed at the cued voice (no lean either way within 10 degrees counts a half). */
  head: number | null;
  /** Head and EEG together favoured the cued voice. */
  fused: number | null;
  /**
   * The same with the head weighed half as much (kappa 1 against the
   * shipped 2), rebuilt from each decision's belief and yaw: the setting
   * research/aad/hold_value.py found holds through glances. Null without
   * a motion sensor.
   */
  fusedLight: number | null;
}

export interface SwitchResult {
  /** When the cue moved, ms from the start, and to which voice. */
  at: number;
  to: number;
  /**
   * The belief favoured the old voice just before: only then does coming
   * over measure anything. A belief already on the new voice was wrong
   * before the switch, not quick after it.
   */
  settled: boolean;
  /** From the cue to the end of the first decision, most of it after the cue, after which the belief favours the new voice; null when missed. */
  tookMs: number | null;
}

export interface AttentionScore {
  /** Decisions whose whole window lies within one cue. */
  decisions: number;
  right: number;
  accuracy: number | null;
  /** The same, by how long the cue had been where it was when the window ended. */
  bySinceSwitch: { fromS: number; toS: number | null; n: number; accuracy: number | null }[];
  /** After each decision, does the belief favour the cued voice? Share of decisions. */
  beliefRight: number | null;
  switches: SwitchResult[];
  /** Of the settled switches: followed before the cue moved again, and not. */
  followed: number;
  missed: number;
  /** Median over followed settled switches, ms. */
  switchMedianMs: number | null;
  /** By where the person faced, when the study asked (experiment 3). */
  byHead: Partial<Record<HeadCondition, HeadScore>>;
}

const SINCE_BINS: [number, number | null][] = [
  [0, 20],
  [20, 40],
  [40, 60],
  [60, null],
];

/**
 * Scores the decoder's decisions against the plan. A decision counts when
 * its whole window is within one cue: one that straddles a switch has heard
 * some of each voice and belongs to neither.
 */
/** The voices' directions the study plays them from, degrees, left negative. */
export const STUDY_AZIMUTHS = [-60, 60] as const;
/** The lighter head prior scored beside the shipped one. */
export const LIGHT_KAPPA = 1;

export function scoreAttention(plan: SwitchPlan, decisions: StudyDecision[], until = Infinity, azimuths: readonly number[] = STUDY_AZIMUTHS): AttentionScore {
  const end = Math.min(plan.durationMs, until);
  const judged = decisions.filter((d) => d.endMs <= end);
  let n = 0;
  let right = 0;
  let beliefN = 0;
  let beliefRight = 0;
  const bins = SINCE_BINS.map(([fromS, toS]) => ({ fromS, toS, n: 0, right: 0 }));
  for (const d of judged) {
    const cue = cuedAt(plan, d.startMs);
    if (!cue || d.endMs > cue.to) continue;
    n++;
    const ok = d.talker === cue.talker;
    if (ok) right++;
    beliefN++;
    if ((d.belief[cue.talker] ?? 0) > 0.5) beliefRight++;
    const since = (d.endMs - cue.from) / 1000;
    const bin = bins.find((b) => since >= b.fromS && (b.toS === null || since < b.toS));
    if (bin) {
      bin.n++;
      if (ok) bin.right++;
    }
  }

  const byHead: Partial<Record<HeadCondition, { n: number; eeg: number; head: number; headN: number; fused: number; fusedN: number; light: number; lightN: number }>> = {};
  for (const d of judged) {
    const cue = cuedAt(plan, d.startMs);
    if (!cue || !cue.head || d.endMs > cue.to) continue;
    const h = (byHead[cue.head] ??= { n: 0, eeg: 0, head: 0, headN: 0, fused: 0, fusedN: 0, light: 0, lightN: 0 });
    h.n++;
    if (d.talker === cue.talker) h.eeg++;
    if (typeof d.yawDeg === "number") {
      h.headN++;
      // Left voice at negative yaw: the head names the voice on the side it leans to.
      if (Math.abs(d.yawDeg) < 10) h.head += 0.5;
      else if ((d.yawDeg < 0 ? 0 : 1) === cue.talker) h.head++;
    }
    if (d.posterior && d.posterior.length > cue.talker) {
      h.fusedN++;
      const best = d.posterior.indexOf(Math.max(...d.posterior));
      if (best === cue.talker) h.fused++;
    }
    if (typeof d.yawDeg === "number" && d.belief.length === azimuths.length) {
      h.lightN++;
      const p = fuseAttention({ azimuthsDeg: [...azimuths], yawDeg: d.yawDeg, belief: d.belief, kappa: LIGHT_KAPPA });
      if (p.indexOf(Math.max(...p)) === cue.talker) h.light++;
    }
  }

  const switches: SwitchResult[] = [];
  const mid = (d: StudyDecision) => (d.startMs + d.endMs) / 2;
  for (let i = 1; i < plan.cues.length; i++) {
    const cue = plan.cues[i]!;
    if (cue.from >= end) break;
    const next = Math.min(cue.to, end);
    const before = [...judged].reverse().find((d) => mid(d) < cue.from);
    const settled = !!before && (before.belief[1 - cue.talker] ?? 0) > 0.5;
    const first = judged.find((d) => mid(d) >= cue.from && d.endMs <= next && (d.belief[cue.talker] ?? 0) > 0.5);
    // A switch the study ended on before it could be followed says nothing either way.
    if (!first && next === end && end < cue.to) continue;
    switches.push({ at: cue.from, to: cue.talker, settled, tookMs: first ? first.endMs - cue.from : null });
  }
  const timed = switches.filter((s) => s.settled);
  const took = timed
    .map((s) => s.tookMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const median = took.length ? (took.length % 2 ? took[(took.length - 1) / 2]! : (took[took.length / 2 - 1]! + took[took.length / 2]!) / 2) : null;

  return {
    decisions: n,
    right,
    accuracy: n ? right / n : null,
    bySinceSwitch: bins.map((b) => ({ fromS: b.fromS, toS: b.toS, n: b.n, accuracy: b.n ? b.right / b.n : null })),
    beliefRight: beliefN ? beliefRight / beliefN : null,
    switches,
    followed: took.length,
    missed: timed.length - took.length,
    switchMedianMs: median,
    byHead: Object.fromEntries(
      Object.entries(byHead).map(([k, h]) => [
        k,
        {
          decisions: h!.n,
          eeg: h!.n ? h!.eeg / h!.n : null,
          head: h!.headN ? h!.head / h!.headN : null,
          fused: h!.fusedN ? h!.fused / h!.fusedN : null,
          fusedLight: h!.lightN ? h!.light / h!.lightN : null,
        },
      ]),
    ) as Partial<Record<HeadCondition, HeadScore>>,
  };
}
