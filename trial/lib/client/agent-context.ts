import type { AgentMomentContext, Moment } from "@/lib/shared/moments";
import { searchFold } from "@/lib/shared/notes";

/**
 * Which moments go with a question to POST /api/agent: at most twelve, chosen
 * here on the device, so the server never sees the rest. A moment is
 * relevant when the question's words appear in it (by prefix, so Turkish
 * suffixes still match: "toplantı" finds "toplantıda"), when it falls in a
 * time the question names ("today", "dün", "this week"), or when the last
 * answer cited it (follow-up questions). Relevant moments go first, by how
 * well they match and how recent they are; the newest of the rest fill the
 * remaining places, so "what did I do today?" still has something to read.
 */

export const MAX_CONTEXT = 12;
/** What every transcript in one request may add up to, in characters. */
const TRANSCRIPT_BUDGET = 24_000;
const RELEVANT_TRANSCRIPT = 4000;
const FILLER_TRANSCRIPT = 800;
const HALF_LIFE_H = 72;

const STOP_WORDS = new Set(
  [
    // English
    "a", "about", "after", "again", "all", "am", "an", "and", "any", "are", "as", "at", "be", "been", "before", "but", "by",
    "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "he", "her", "him", "his", "how", "i", "if",
    "in", "into", "is", "it", "its", "just", "me", "my", "of", "on", "or", "our", "out", "said", "say", "she", "so", "some",
    "tell", "than", "that", "the", "their", "them", "then", "there", "they", "this", "to", "up", "us", "was", "we", "were",
    "what", "when", "where", "which", "who", "whom", "why", "will", "with", "would", "you", "your", "anything", "something",
    "talk", "talked", "remind", "please", "moment", "moments",
    // Times are read by timeWindow, not matched as words.
    "today", "yesterday", "tonight", "morning", "evening", "night", "week", "last", "this",
    // Turkish, folded (no Turkish letters, as searchFold leaves them)
    "acaba", "ama", "ben", "beni", "bana", "benim", "bir", "biz", "bize", "bu", "bunu", "buna", "da", "de", "daha", "diye",
    "en", "gibi", "hangi", "hem", "hep", "hic", "icin", "ile", "ise", "kadar", "ki", "kim", "kime", "kimi", "kimle", "kimlerle",
    "mi", "mu", "mı", "mü", "ne", "neden", "nasil", "nerede", "neler", "o", "ona", "onu", "sen", "sana", "seni", "siz", "size",
    "su", "ve", "ya", "yani", "soyle", "dedi", "an", "anlar", "ani",
    "bugun", "bugunku", "dun", "dunku", "sabah", "aksam", "gece", "hafta", "gecen",
  ].map((w) => searchFold(w)),
);

export function questionTerms(text: string): string[] {
  const words = searchFold(text).split(" ").filter(Boolean);
  return [...new Set(words.filter((w) => (w.length >= 2 || /\d/.test(w)) && !STOP_WORDS.has(w)))].slice(0, 12);
}

/**
 * A question word matches a moment's word when one starts the other: the
 * moment's word may carry a suffix the question does not ("toplanti" and
 * "toplantida"), or the question's may ("ayse'yle" folded to "ayseyle",
 * and "ayse").
 */
export function termMatches(term: string, word: string): boolean {
  if (word.startsWith(term)) return term.length >= 2;
  return word.length >= 4 && term.length > word.length && term.startsWith(word);
}

const WEIGHTS = {
  title: 3,
  people: 3,
  topics: 2.5,
  place: 2,
  keyPoints: 1.5,
  actionItems: 1.5,
  summary: 1,
  transcript: 0.6,
} as const;

const words = (s: string) => searchFold(s).split(" ").filter(Boolean);

function fieldsOf(m: Moment): { weight: number; words: string[] }[] {
  return [
    { weight: WEIGHTS.title, words: words(m.title) },
    { weight: WEIGHTS.people, words: words(m.people.join(" ")) },
    { weight: WEIGHTS.topics, words: words(m.topics.join(" ")) },
    { weight: WEIGHTS.place, words: words(m.place?.name ?? "") },
    { weight: WEIGHTS.keyPoints, words: words(m.keyPoints.join(" ")) },
    { weight: WEIGHTS.actionItems, words: words(m.actionItems.map((a) => a.text).join(" ")) },
    { weight: WEIGHTS.summary, words: words(m.summary) },
    { weight: WEIGHTS.transcript, words: words(m.transcript) },
  ];
}

/** Each question word counts once, at the weight of the best field it appears in; 0 when none appears. */
export function keywordScore(terms: readonly string[], m: Moment): number {
  if (!terms.length) return 0;
  const fields = fieldsOf(m);
  let sum = 0;
  for (const t of terms) {
    let best = 0;
    for (const f of fields) if (f.weight > best && f.words.some((w) => termMatches(t, w))) best = f.weight;
    sum += best;
  }
  return sum;
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The span a question names, if it names one: today, yesterday, this morning, last night, this week, last week. */
export function timeWindow(text: string, now: Date): { from: number; to: number } | null {
  const f = ` ${searchFold(text)} `;
  const has = (...phrases: string[]) => phrases.some((p) => f.includes(` ${p} `));
  const today = startOfDay(now);
  const end = now.getTime() + 60_000;
  if (has("this morning", "bu sabah")) return { from: today + 5 * 3_600_000, to: today + 12 * 3_600_000 };
  if (has("last night", "dun aksam", "dun gece")) return { from: today - DAY + 17 * 3_600_000, to: today + 5 * 3_600_000 };
  if (has("tonight", "this evening", "bu aksam")) return { from: today + 17 * 3_600_000, to: end };
  if (has("yesterday", "dun", "dunku")) return { from: today - DAY, to: today };
  if (has("today", "bugun", "bugunku")) return { from: today, to: end };
  const monday = today - ((now.getDay() + 6) % 7) * DAY;
  if (has("last week", "gecen hafta")) return { from: monday - 7 * DAY, to: monday };
  if (has("this week", "bu hafta")) return { from: monday, to: end };
  return null;
}

export interface ContextOptions {
  now: Date;
  max?: number;
  /** Always included, first: the moment a question was asked from. */
  focusId?: string | null;
  /** Moments the last answers cited, for follow-up questions. */
  recentCites?: readonly string[];
}

/** The moments to send with a question, most relevant first. */
export function selectContext(question: string, moments: readonly Moment[], opts: ContextOptions): Moment[] {
  const max = opts.max ?? MAX_CONTEXT;
  const terms = questionTerms(question);
  const span = timeWindow(question, opts.now);
  const cited = new Set(opts.recentCites ?? []);
  const nowMs = opts.now.getTime();

  const scored = moments.map((m) => {
    const t = Date.parse(m.createdAt);
    const kw = terms.length ? keywordScore(terms, m) / terms.length : 0;
    const inSpan = !!span && t >= span.from && t < span.to;
    const recency = Math.exp((-Math.max(0, nowMs - t) / 3_600_000) * (Math.LN2 / HALF_LIFE_H));
    const relevant = kw > 0 || inSpan || cited.has(m.id) || m.id === opts.focusId;
    const score = kw * 3 + (inSpan ? 2 : 0) + (cited.has(m.id) ? 1.5 : 0) + recency + (m.pinned ? 0.25 : 0);
    return { m, t, relevant, score };
  });

  const focus = scored.find((s) => s.m.id === opts.focusId);
  const relevant = scored.filter((s) => s.relevant && s !== focus).sort((a, b) => b.score - a.score || b.t - a.t);
  const chosen = [...(focus ? [focus] : []), ...relevant].slice(0, max);
  const taken = new Set(chosen.map((s) => s.m.id));
  const fillers = scored.filter((s) => !taken.has(s.m.id)).sort((a, b) => b.t - a.t).slice(0, max - chosen.length);
  return [...chosen, ...fillers].map((s) => s.m);
}

const clip = (s: string, n: number) => {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, Math.max(0, n - 1)).trimEnd()}…`;
};

const COORDINATES = /^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/;

/** One moment as the contract carries it, trimmed to its limits. */
export function toContext(m: Moment, transcriptChars: number = RELEVANT_TRANSCRIPT): AgentMomentContext {
  const placeName = m.place?.name && !COORDINATES.test(m.place.name) ? clip(m.place.name, 160) : null;
  return {
    id: m.id.slice(0, 64),
    createdAt: m.createdAt.slice(0, 40),
    place: placeName,
    title: clip(m.title, 120),
    summary: clip(m.summary, 800),
    keyPoints: m.keyPoints.slice(0, 6).map((p) => clip(p, 240)),
    actionItems: m.actionItems.slice(0, 6).map((a) => ({ text: clip(a.text, 240), due: a.due ? a.due.slice(0, 40) : null })),
    people: m.people.slice(0, 8).map((p) => clip(p, 60)),
    transcript: clip(m.transcript, Math.max(0, Math.min(4000, transcriptChars))),
  };
}

/**
 * The context for one question: the chosen moments, the relevant ones with
 * longer transcripts than the ones that only fill places, all within one
 * budget.
 */
export function buildContext(question: string, moments: readonly Moment[], opts: ContextOptions): AgentMomentContext[] {
  const chosen = selectContext(question, moments, opts);
  const terms = questionTerms(question);
  const span = timeWindow(question, opts.now);
  const cited = new Set(opts.recentCites ?? []);
  let left = TRANSCRIPT_BUDGET;
  return chosen.map((m) => {
    const t = Date.parse(m.createdAt);
    const relevant =
      m.id === opts.focusId || cited.has(m.id) || (!!span && t >= span.from && t < span.to) || keywordScore(terms, m) > 0;
    const want = Math.min(relevant ? RELEVANT_TRANSCRIPT : FILLER_TRANSCRIPT, left);
    const ctx = toContext(m, want);
    left = Math.max(0, left - ctx.transcript.length);
    return ctx;
  });
}

/* ---- Search in the feed ------------------------------------------------------------ */

/** Every word of the query appears somewhere in the moment (by prefix, as above). */
export function momentMatches(m: Moment, query: string): boolean {
  const terms = searchFold(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const all = fieldsOf(m).flatMap((f) => f.words);
  return terms.every((t) => all.some((w) => termMatches(t, w)));
}

export interface Facet {
  kind: "person" | "topic";
  value: string;
  count: number;
}

/** The people and topics across moments, most frequent first; spellings that fold alike count as one. */
export function facetsOf(moments: readonly Moment[], max = 8): { people: Facet[]; topics: Facet[] } {
  const tally = (kind: Facet["kind"], pick: (m: Moment) => string[]) => {
    const byKey = new Map<string, Facet>();
    for (const m of moments) {
      for (const raw of new Set(pick(m).map((x) => x.trim()).filter(Boolean))) {
        const key = searchFold(raw);
        const f = byKey.get(key);
        if (f) f.count++;
        else byKey.set(key, { kind, value: raw, count: 1 });
      }
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, max);
  };
  return { people: tally("person", (m) => m.people), topics: tally("topic", (m) => m.topics) };
}

export function hasFacet(m: Moment, f: Pick<Facet, "kind" | "value">): boolean {
  const key = searchFold(f.value);
  return (f.kind === "person" ? m.people : m.topics).some((x) => searchFold(x) === key);
}
