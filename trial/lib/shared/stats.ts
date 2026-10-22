/**
 * Small, dependency free statistics used by the lab dashboard and the latency
 * panel. Everything random is seeded so a dashboard renders the same interval
 * for the same data on every load.
 */

/** Mulberry32: tiny, fast, good enough for resampling indices. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear interpolation between closest ranks (the common "type 7" definition). */
export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (Math.min(Math.max(p, 0), 100) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

export interface ErrorCount {
  /** Word (or character) edits for one scored transcript. */
  errors: number;
  /** Reference words (or characters) for the same transcript. */
  total: number;
  /**
   * Rows sharing a cluster are resampled together. Use the recorded take, so
   * that one utterance scored by three providers is not counted as three
   * independent observations.
   */
  cluster: string;
}

export interface RateEstimate {
  /** Corpus level rate: sum of errors over sum of reference units. */
  rate: number | null;
  lo: number | null;
  hi: number | null;
  /** Distinct clusters (utterances). */
  n: number;
  /** Scored rows. */
  rows: number;
}

export function corpusRate(items: readonly Pick<ErrorCount, "errors" | "total">[]): number | null {
  let errors = 0;
  let total = 0;
  for (const it of items) {
    errors += it.errors;
    total += it.total;
  }
  return total > 0 ? errors / total : null;
}

/**
 * Percentile bootstrap over clusters. With fewer than two clusters there is no
 * spread to estimate, so the interval is reported as unknown rather than as a
 * misleading zero width band.
 */
export function bootstrapRate(
  items: readonly ErrorCount[],
  { iterations = 1000, confidence = 0.95, seed = 20261021 } = {},
): RateEstimate {
  const byCluster = new Map<string, { errors: number; total: number }>();
  for (const it of items) {
    const c = byCluster.get(it.cluster) ?? { errors: 0, total: 0 };
    c.errors += it.errors;
    c.total += it.total;
    byCluster.set(it.cluster, c);
  }
  const clusters = [...byCluster.values()];
  const rate = corpusRate(clusters);
  const base = { rate, n: clusters.length, rows: items.length };
  if (clusters.length < 2 || rate === null) return { ...base, lo: null, hi: null };

  const rand = seededRandom(seed);
  const samples: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let errors = 0;
    let total = 0;
    for (let k = 0; k < clusters.length; k++) {
      const c = clusters[Math.floor(rand() * clusters.length)]!;
      errors += c.errors;
      total += c.total;
    }
    if (total > 0) samples.push(errors / total);
  }
  const tail = ((1 - confidence) / 2) * 100;
  return { ...base, lo: percentile(samples, tail), hi: percentile(samples, 100 - tail) };
}
