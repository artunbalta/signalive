/**
 * Minimum edit alignment between a reference and a hypothesis sequence, with
 * the edit counts split into substitutions, deletions and insertions.
 *
 * Deletion: a reference item missing from the hypothesis.
 * Insertion: a hypothesis item with no reference counterpart.
 * When several alignments have the same total cost, the backtrace prefers a
 * match or substitution, then a deletion, then an insertion. The total is the
 * same either way; only the split between the three kinds can differ.
 */

export interface EditCounts {
  distance: number;
  hits: number;
  substitutions: number;
  deletions: number;
  insertions: number;
}

export function align<T>(reference: readonly T[], hypothesis: readonly T[]): EditCounts {
  const n = reference.length;
  const m = hypothesis.length;
  const cols = m + 1;
  const d = new Int32Array((n + 1) * cols);

  for (let i = 0; i <= n; i++) d[i * cols] = i;
  for (let j = 0; j <= m; j++) d[j] = j;

  for (let i = 1; i <= n; i++) {
    const r = reference[i - 1];
    for (let j = 1; j <= m; j++) {
      const cost = r === hypothesis[j - 1] ? 0 : 1;
      const diag = d[(i - 1) * cols + (j - 1)]! + cost;
      const del = d[(i - 1) * cols + j]! + 1;
      const ins = d[i * cols + (j - 1)]! + 1;
      d[i * cols + j] = Math.min(diag, del, ins);
    }
  }

  let i = n;
  let j = m;
  let hits = 0;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  while (i > 0 || j > 0) {
    const here = d[i * cols + j]!;
    if (i > 0 && j > 0) {
      const same = reference[i - 1] === hypothesis[j - 1];
      if (here === d[(i - 1) * cols + (j - 1)]! + (same ? 0 : 1)) {
        if (same) hits++;
        else substitutions++;
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && here === d[(i - 1) * cols + j]! + 1) {
      deletions++;
      i--;
      continue;
    }
    insertions++;
    j--;
  }

  return { distance: d[n * cols + m]!, hits, substitutions, deletions, insertions };
}

/** Plain edit distance between two strings, counted in Unicode code points. */
export function levenshtein(a: string, b: string): number {
  return align(Array.from(a), Array.from(b)).distance;
}
