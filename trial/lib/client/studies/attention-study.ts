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

/** The decoder's decision window, s. */
export const DECISION_S = 10;
/** Envelope rate, Hz: the decoder's. */
export const ENV_RATE = 64;

export interface CueSegment {
  /** ms from the start of the study. */
  from: number;
  to: number;
  /** 0 the left voice, 1 the right one. */
  talker: number;
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
  while (t < durationMs) {
    const to = Math.min(durationMs, Math.round(t + minHold + rand() * (maxHold - minHold)));
    cues.push({ from: Math.round(t), to, talker });
    t = to;
    talker = 1 - talker;
  }
  return { cues, durationMs, seed };
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
export function scoreAttention(plan: SwitchPlan, decisions: StudyDecision[], until = Infinity): AttentionScore {
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
  };
}
