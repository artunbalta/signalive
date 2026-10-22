import { bootstrapRate, type RateEstimate } from "../stats";
import { CHAINS, ENVIRONMENTS, NOISY_ENVIRONMENTS, type LabResult } from "../types";

/**
 * Turns lab result rows into the dashboard's numbers. Rates are corpus level
 * (all errors over all reference words in the group), and intervals come
 * from resampling takes, so one recording scored by three recognizers counts
 * as one observation in the interval, not three.
 */

export interface GroupStat {
  key: string;
  wer: RateEstimate;
  cer: RateEstimate;
}

export interface Split {
  usable: LabResult[];
  mock: number;
  failed: number;
}

/** Mock rows are simulations and failed calls have no transcript: neither is a measurement. */
export function splitRows(rows: readonly LabResult[], includeMock = false): Split {
  let mock = 0;
  let failed = 0;
  const usable: LabResult[] = [];
  for (const r of rows) {
    if (r.error !== null || r.wer === null) failed++;
    else if (r.provider === "mock" && !includeMock) mock++;
    else usable.push(r);
  }
  return { usable, mock, failed };
}

function stat(key: string, rows: readonly LabResult[]): GroupStat {
  return {
    key,
    wer: bootstrapRate(rows.map((r) => ({ errors: r.substitutions + r.deletions + r.insertions, total: r.refWords, cluster: r.takeId }))),
    cer: bootstrapRate(rows.map((r) => ({ errors: r.charErrors, total: r.refChars, cluster: r.takeId }))),
  };
}

export function groupStats(rows: readonly LabResult[], keyOf: (r: LabResult) => string, order?: readonly string[]): GroupStat[] {
  const groups = new Map<string, LabResult[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const keys = [...groups.keys()];
  const rank = (k: string) => (order ? (order.indexOf(k) === -1 ? order.length : order.indexOf(k)) : 0);
  keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return keys.map((k) => stat(k, groups.get(k)!));
}

export const conditionKey = (r: LabResult) => `${r.voiceStyle}|${r.environment}`;
export const CONDITION_ORDER = (["normal", "whisper"] as const).flatMap((v) => ENVIRONMENTS.map((e) => `${v}|${e}`));

export function dashboard(rows: readonly LabResult[], includeMock = false) {
  const split = splitRows(rows, includeMock);
  const u = split.usable;
  return {
    ...split,
    byCondition: groupStats(u, conditionKey, CONDITION_ORDER),
    byDevice: groupStats(u, (r) => r.deviceLabel || "unknown"),
    byChain: groupStats(u, (r) => r.chain, CHAINS),
    byProvider: groupStats(u, (r) => `${r.provider}|${r.model}`),
    headline: headline(u),
  };
}

/**
 * The number the lab exists for: whispered speech in wind or noise, at the
 * processing chain that does best there (all recognizers pooled), with the
 * best recognizer for that chain alongside.
 */
export function headline(rows: readonly LabResult[]) {
  const target = rows.filter((r) => r.voiceStyle === "whisper" && NOISY_ENVIRONMENTS.includes(r.environment));
  if (target.length === 0) return null;
  const chains = groupStats(target, (r) => r.chain, CHAINS).filter((c) => c.wer.rate !== null);
  if (chains.length === 0) return null;
  const best = chains.reduce((a, b) => (b.wer.rate! < a.wer.rate! ? b : a));
  const providers = groupStats(
    target.filter((r) => r.chain === best.key),
    (r) => `${r.provider}|${r.model}`,
  ).filter((p) => p.wer.rate !== null);
  const bestProvider = providers.length ? providers.reduce((a, b) => (b.wer.rate! < a.wer.rate! ? b : a)) : null;
  return { chain: best.key, stat: best, bestProvider };
}
