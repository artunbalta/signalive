import "server-only";
import type { AgentMomentContext } from "@/lib/shared/moments";
import { searchFold } from "@/lib/shared/notes";

/**
 * find_moments: keyword search over the moments the device sent with one
 * question, and nothing else (the server keeps no moments). Words are folded
 * like note search, so "toplanti" finds "toplantıda", and match as prefixes
 * either way ("meetings" finds "meeting"). A match in the title or the
 * people counts most, then the summary, key points and action items, then
 * the place and what was said; among equal scores the newer moment wins.
 */

export interface MomentHit {
  moment: AgentMomentContext;
  score: number;
  /** Which fields matched. */
  fields: string[];
  /** What was said around the first match in the transcript, when it matched there. */
  excerpt: string | null;
}

const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "about", "from", "by",
  "what", "when", "where", "who", "which", "how", "why", "did", "do", "does", "is", "are", "was", "were",
  "be", "i", "me", "my", "we", "our", "you", "your", "it", "that", "this", "there", "say", "said", "tell",
  "any", "all", "some", "moment", "moments",
  // Turkish (folded)
  "ve", "ile", "bir", "bu", "su", "o", "ne", "neydi", "nerede", "kim", "mi", "mu", "da", "de", "ki",
  "icin", "hakkinda", "dedi", "soyledi", "ben", "benim", "bana", "biz", "sen", "an", "anlar",
]);

const FIELD_WEIGHTS = { title: 3, people: 3, summary: 2, keyPoints: 2, actionItems: 2, place: 1, transcript: 1 } as const;
type Field = keyof typeof FIELD_WEIGHTS;

/** The words of a query worth looking for, folded. */
export function queryWords(query: string): string[] {
  const words = [...new Set(searchFold(query).split(" ").filter((w) => w.length >= 2 || /\d/.test(w)))];
  const kept = words.filter((w) => !STOPWORDS.has(w));
  return (kept.length ? kept : words).slice(0, 12);
}

/** A folded token matches a folded query word as a prefix, either way round, or exactly for numbers. */
function matches(token: string, word: string): boolean {
  if (/^\d+$/.test(word)) return token === word;
  if (token.startsWith(word)) return true;
  return token.length >= 4 && word.startsWith(token) && word.length - token.length <= 3;
}

const tokens = (text: string) => searchFold(text).split(" ").filter(Boolean);

export function searchMoments(moments: AgentMomentContext[], query: string, limit = 4): MomentHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  // Newest first: the rank sets the recency bonus, which only breaks ties.
  const byAge = [...moments].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const hits: MomentHit[] = [];
  byAge.forEach((m, rank) => {
    const fields: Record<Field, string[]> = {
      title: tokens(m.title),
      people: tokens(m.people.join(" ")),
      summary: tokens(m.summary),
      keyPoints: tokens(m.keyPoints.join(" ")),
      actionItems: tokens(m.actionItems.map((a) => a.text).join(" ")),
      place: tokens(m.place ?? ""),
      transcript: tokens(m.transcript),
    };
    let score = 0;
    const matched = new Set<Field>();
    for (const word of words) {
      let best = 0;
      for (const field of Object.keys(fields) as Field[]) {
        if (fields[field].some((t) => matches(t, word))) {
          matched.add(field);
          best = Math.max(best, FIELD_WEIGHTS[field]);
        }
      }
      score += best;
    }
    if (score === 0) return;
    score += 0.5 * (1 - rank / Math.max(1, byAge.length));
    hits.push({
      moment: m,
      score,
      fields: [...matched],
      excerpt: matched.has("transcript") ? excerpt(m.transcript, words) : null,
    });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

const EXCERPT_CHARS = 600;

/** The transcript around its first word that matches the query, cut at word boundaries. */
export function excerpt(transcript: string, words: string[]): string {
  let at = -1;
  for (const m of transcript.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)) {
    const folded = searchFold(m[0]).replace(/ /g, "");
    if (words.some((w) => matches(folded, w))) {
      at = m.index;
      break;
    }
  }
  if (transcript.length <= EXCERPT_CHARS) return transcript.trim();
  let start = Math.max(0, Math.min(at - EXCERPT_CHARS / 3, transcript.length - EXCERPT_CHARS));
  let end = Math.min(transcript.length, start + EXCERPT_CHARS);
  if (start > 0) start = transcript.indexOf(" ", start) + 1 || start;
  if (end < transcript.length) end = transcript.lastIndexOf(" ", end) > start ? transcript.lastIndexOf(" ", end) : end;
  return `${start > 0 ? "…" : ""}${transcript.slice(start, end).trim()}${end < transcript.length ? "…" : ""}`;
}
