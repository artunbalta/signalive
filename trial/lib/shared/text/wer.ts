import type { Lang } from "../types";
import { align } from "./levenshtein";
import { normalizeTranscript } from "./normalize";

export interface TranscriptScore {
  /** (S + D + I) / reference words. Can exceed 1 when the hypothesis adds words. */
  wer: number;
  /** Character edits / reference characters, spaces between words included. */
  cer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  refWords: number;
  hypWords: number;
  charErrors: number;
  refChars: number;
  normalizedReference: string;
  normalizedHypothesis: string;
}

/**
 * Scores one transcript against its reference. Both strings are normalized in
 * the reference's language first (see normalize.ts).
 *
 * An empty reference can only score 0 (empty hypothesis) or 1 (anything else),
 * since a rate over zero words is undefined.
 */
export function scoreTranscript(reference: string, hypothesis: string, lang: Lang): TranscriptScore {
  const refTokens = normalizeTranscript(reference, lang);
  const hypTokens = normalizeTranscript(hypothesis, lang);
  const words = align(refTokens, hypTokens);

  const refString = refTokens.join(" ");
  const hypString = hypTokens.join(" ");
  const refChars = Array.from(refString);
  const chars = align(refChars, Array.from(hypString));

  const rate = (errors: number, total: number) => (total === 0 ? (errors === 0 ? 0 : 1) : errors / total);

  return {
    wer: rate(words.distance, refTokens.length),
    cer: rate(chars.distance, refChars.length),
    substitutions: words.substitutions,
    deletions: words.deletions,
    insertions: words.insertions,
    refWords: refTokens.length,
    hypWords: hypTokens.length,
    charErrors: chars.distance,
    refChars: refChars.length,
    normalizedReference: refString,
    normalizedHypothesis: hypString,
  };
}
