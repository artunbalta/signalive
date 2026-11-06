/**
 * The clench study (research/NEXT.md, experiment 1): does a real clench
 * survive real life? This file is the part with no device and no screen in
 * it: the plan of prompts, and the score of what the detector reported
 * against them. clench-runner.ts plays the plan on whatever earbuds are
 * connected and feeds the detections back here.
 *
 * A plan is a list of prompted clenches, balanced across the three kinds and
 * the four conditions (sitting, talking, walking, chewing), at random gaps,
 * followed by a free period of normal life with no clench asked for. A
 * detection counts for a prompt when it comes within RESPONSE_MS of it; each
 * detection counts for one prompt at most. A detection during the free
 * period is a false one. The bars are the study's own: 95% of single
 * clenches caught, under one false detection an hour, under 0.7 s from the
 * jaw to the report.
 */

export type ClenchKind = "single" | "double" | "hold";
export type StudyCondition = "sitting" | "talking" | "walking" | "chewing";

export const CLENCH_KINDS: readonly ClenchKind[] = ["single", "double", "hold"];
export const STUDY_CONDITIONS: readonly StudyCondition[] = ["sitting", "talking", "walking", "chewing"];

/** A detection this long after its prompt still answers it: time to hear the cue, clench, and be detected. */
export const RESPONSE_MS = 3500;
/** Nothing earlier than this after a cue can be an answer to it: no one clenches faster. */
export const EARLIEST_MS = 150;

export const BARS = {
  /** Share of prompted single clenches the detector must report as singles. */
  singles: 0.95,
  /** False detections an hour in the free period. */
  falsePerHour: 1,
  /**
   * Median time from the start of the jaw's activity to the report of a
   * single clench, ms. A hold is reported 700 ms in by design, and a double
   * only once its second burst is over, so they are timed but not held to it.
   */
  latencyMs: 700,
} as const;

export interface StudyPrompt {
  /** Order in the plan, from 0. */
  i: number;
  kind: ClenchKind;
  condition: StudyCondition;
  /** When the cue sounds, ms from the start of the study. */
  at: number;
}

export interface ClenchStudyPlan {
  prompts: StudyPrompt[];
  /** When each condition begins, ms, in plan order; the runner tells the person to change. */
  conditionStarts: { condition: StudyCondition; at: number }[];
  /** The free period: no prompts, every detection is false. */
  freeFrom: number;
  freeTo: number;
  seed: number;
}

export interface PlanOptions {
  /** Prompts of each kind. NEXT.md: 20. */
  perKind: number;
  conditions?: readonly StudyCondition[];
  /** Gap between cues, ms. */
  minGapMs?: number;
  maxGapMs?: number;
  /** Time to settle into a new condition before its first cue. */
  changeMs?: number;
  /** Length of the free period, minutes. NEXT.md: 20. */
  freeMinutes: number;
  seed?: number;
}

/** A small seeded generator, so a plan can be rebuilt from its seed alone. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/**
 * The prompts, condition by condition. Each condition gets the same number
 * of each kind as nearly as the counts allow, and the kinds are shuffled
 * within it, so a person cannot predict the next cue.
 */
export function planClenchStudy(opts: PlanOptions): ClenchStudyPlan {
  const conditions = opts.conditions ?? STUDY_CONDITIONS;
  const minGap = opts.minGapMs ?? 6000;
  const maxGap = Math.max(minGap, opts.maxGapMs ?? 15000);
  const change = opts.changeMs ?? 8000;
  const seed = (opts.seed ?? Date.now()) >>> 0;
  if (!(opts.perKind >= 1) || !Number.isInteger(opts.perKind)) throw new RangeError("studies: perKind must be a positive integer");
  if (conditions.length < 1) throw new RangeError("studies: at least one condition");
  if (!(opts.freeMinutes >= 0)) throw new RangeError("studies: freeMinutes must not be negative");
  const rand = mulberry32(seed);

  // Deal each kind's prompts round robin over the conditions.
  const byCondition = conditions.map(() => [] as ClenchKind[]);
  let slot = 0;
  for (const kind of CLENCH_KINDS) {
    for (let n = 0; n < opts.perKind; n++) byCondition[slot++ % conditions.length]!.push(kind);
  }

  const prompts: StudyPrompt[] = [];
  const conditionStarts: ClenchStudyPlan["conditionStarts"] = [];
  let t = 0;
  conditions.forEach((condition, c) => {
    conditionStarts.push({ condition, at: t });
    t += change;
    for (const kind of shuffle(byCondition[c]!, rand)) {
      prompts.push({ i: prompts.length, kind, condition, at: Math.round(t) });
      t += minGap + rand() * (maxGap - minGap);
    }
  });
  const freeFrom = Math.round(t);
  return { prompts, conditionStarts, freeFrom, freeTo: freeFrom + Math.round(opts.freeMinutes * 60_000), seed };
}

export interface StudyDetection {
  kind: ClenchKind;
  /** When the detector reported it, ms from the start of the study. */
  at: number;
  /** How long after the jaw's activity began it was reported, when the detector knows. */
  latencyMs?: number;
  confidence?: number;
}

export type PromptOutcome = "caught" | "misread" | "missed";

export interface PromptResult {
  prompt: StudyPrompt;
  outcome: PromptOutcome;
  /** The kind the answering detection was read as; null when nothing answered. */
  detected: ClenchKind | null;
  /** The detection that answered it. */
  detection: StudyDetection | null;
  /** From the cue to the report, ms. */
  responseMs: number | null;
}

export interface KindScore {
  prompted: number;
  caught: number;
  misread: number;
  missed: number;
  /** caught / prompted */
  rate: number;
}

export interface ClenchStudyScore {
  results: PromptResult[];
  byKind: Record<ClenchKind, KindScore>;
  byCondition: Record<StudyCondition, KindScore>;
  /** confusion[prompted][reported or "none"] */
  confusion: Record<ClenchKind, Record<ClenchKind | "none", number>>;
  /** Detections in the prompted part that answered no prompt. */
  extra: number;
  falseCount: number;
  freeMinutes: number;
  falsePerHour: number | null;
  /** Jaw to report for caught single clenches: the bar. */
  latency: { medianMs: number | null; p90Ms: number | null; n: number };
  /** The same median for each kind. */
  latencyByKind: Record<ClenchKind, number | null>;
  response: { medianMs: number | null };
  pass: { singles: boolean; falsePerHour: boolean | null; latency: boolean | null };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function emptyScore(): KindScore {
  return { prompted: 0, caught: 0, misread: 0, missed: 0, rate: 0 };
}

/**
 * Scores detections against a plan. Prompts are answered in order: each
 * takes the first unused detection in its window, so two quick prompts
 * cannot both claim one detection, and a late answer to one prompt cannot
 * be counted for the next. `until` is how far the study got, ms: prompts
 * after it are left out, and the free period counts only up to it.
 */
export function scoreClenchStudy(plan: ClenchStudyPlan, detections: StudyDetection[], until = Infinity): ClenchStudyScore {
  const dets = detections.slice().sort((a, b) => a.at - b.at);
  const used = new Set<number>();
  const results: PromptResult[] = [];
  const byKind = { single: emptyScore(), double: emptyScore(), hold: emptyScore() } as Record<ClenchKind, KindScore>;
  const byCondition = Object.fromEntries(STUDY_CONDITIONS.map((c) => [c, emptyScore()])) as Record<StudyCondition, KindScore>;
  const confusion = Object.fromEntries(CLENCH_KINDS.map((k) => [k, { single: 0, double: 0, hold: 0, none: 0 }])) as ClenchStudyScore["confusion"];

  for (const prompt of plan.prompts) {
    if (prompt.at + RESPONSE_MS > until) break;
    const next = plan.prompts[prompt.i + 1];
    const end = Math.min(prompt.at + RESPONSE_MS, next ? next.at + EARLIEST_MS : Infinity);
    let found = -1;
    for (let j = 0; j < dets.length; j++) {
      if (used.has(j)) continue;
      const d = dets[j]!;
      if (d.at < prompt.at + EARLIEST_MS) continue;
      if (d.at > end) break;
      found = j;
      break;
    }
    const detection = found >= 0 ? dets[found]! : null;
    if (found >= 0) used.add(found);
    const detected = detection?.kind ?? null;
    const outcome: PromptOutcome = !detection ? "missed" : detected === prompt.kind ? "caught" : "misread";
    results.push({ prompt, outcome, detected, detection, responseMs: detection ? detection.at - prompt.at : null });
    for (const s of [byKind[prompt.kind], byCondition[prompt.condition]]) {
      s.prompted++;
      s[outcome]++;
    }
    confusion[prompt.kind][detected ?? "none"]++;
  }
  for (const s of [...Object.values(byKind), ...Object.values(byCondition)]) s.rate = s.prompted ? s.caught / s.prompted : 0;

  const freeTo = Math.min(plan.freeTo, until);
  let extra = 0;
  let falseCount = 0;
  dets.forEach((d, j) => {
    if (used.has(j)) return;
    if (d.at >= plan.freeFrom && d.at <= freeTo) falseCount++;
    else if (d.at < plan.freeFrom) extra++;
  });
  const freeMinutes = Math.max(0, freeTo - plan.freeFrom) / 60_000;
  const falsePerHour = freeMinutes > 0 ? (falseCount / freeMinutes) * 60 : null;

  const latencyOf = (kind: ClenchKind) =>
    results
      .map((r) => (r.outcome === "caught" && r.prompt.kind === kind ? r.detection?.latencyMs : undefined))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
  const latencies = latencyOf("single");
  const responses = results
    .filter((r) => r.responseMs !== null)
    .map((r) => r.responseMs as number)
    .sort((a, b) => a - b);
  const medianLatency = quantile(latencies, 0.5);

  return {
    results,
    byKind,
    byCondition,
    confusion,
    extra,
    falseCount,
    freeMinutes,
    falsePerHour,
    latency: { medianMs: medianLatency, p90Ms: quantile(latencies, 0.9), n: latencies.length },
    latencyByKind: {
      single: medianLatency,
      double: quantile(latencyOf("double"), 0.5),
      hold: quantile(latencyOf("hold"), 0.5),
    },
    response: { medianMs: quantile(responses, 0.5) },
    pass: {
      singles: byKind.single.prompted > 0 && byKind.single.rate >= BARS.singles,
      falsePerHour: falsePerHour === null ? null : falsePerHour < BARS.falsePerHour,
      latency: medianLatency === null ? null : medianLatency < BARS.latencyMs,
    },
  };
}
