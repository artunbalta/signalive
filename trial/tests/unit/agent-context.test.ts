import { describe, expect, it } from "vitest";
import {
  buildContext,
  facetsOf,
  hasFacet,
  keywordScore,
  MAX_CONTEXT,
  momentMatches,
  questionTerms,
  selectContext,
  termMatches,
  timeWindow,
  toContext,
} from "@/lib/client/agent-context";
import { AgentRequestSchema, type Moment } from "@/lib/shared/moments";

const NOW = new Date("2026-11-02T15:00:00");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function moment(id: string, h: number, over: Partial<Moment> = {}): Moment {
  return {
    id,
    createdAt: hoursAgo(h),
    timeZone: null,
    place: null,
    trigger: "clench",
    seconds: 30,
    transcript: "Some talk about nothing in particular.",
    title: `Moment ${id}`,
    summary: "A quiet moment.",
    keyPoints: [],
    actionItems: [],
    people: [],
    topics: [],
    language: "en",
    actions: [],
    pinned: false,
    ...over,
  };
}

describe("context selection", () => {
  it("keeps the words that carry meaning, folded the way search folds", () => {
    expect(questionTerms("What did Ayşe say about the launch deck?")).toEqual(["ayse", "launch", "deck"]);
    expect(questionTerms("Ayşe'yle toplantıda ne konuştuk?")).toEqual(["ayseyle", "toplantida", "konustuk"]);
    expect(questionTerms("What did I promise to do today?")).toEqual(["promise"]);
  });

  it("matches by prefix in both directions, so suffixes do not hide a word", () => {
    expect(termMatches("toplanti", "toplantida")).toBe(true);
    expect(termMatches("ayseyle", "ayse")).toBe(true);
    expect(termMatches("deck", "decks")).toBe(true);
    expect(termMatches("dec", "deck")).toBe(true);
    // Short stored words do not swallow longer questions.
    expect(termMatches("another", "an")).toBe(false);
    expect(termMatches("venue", "deck")).toBe(false);
  });

  it("weighs a word by the best place it appears in", () => {
    const m = moment("a", 1, { title: "Venue call", transcript: "the projector at the venue" });
    expect(keywordScore(["venue"], m)).toBe(3);
    expect(keywordScore(["projector"], m)).toBeCloseTo(0.6);
    expect(keywordScore(["budget"], m)).toBe(0);
  });

  it("puts the moments that match first, however old, then fills with the newest", () => {
    const moments = [
      ...Array.from({ length: 20 }, (_, i) => moment(`n${i}`, i + 1)),
      moment("venue", 24 * 9, { title: "Call the venue", people: ["Ayşe"] }),
      moment("ayse", 24 * 3, { people: ["Ayşe"], summary: "Ayşe sends the deck." }),
    ];
    const chosen = selectContext("When do I call the venue?", moments, { now: NOW });
    expect(chosen).toHaveLength(MAX_CONTEXT);
    expect(chosen[0]!.id).toBe("venue");
    // The rest are the newest of the others.
    expect(chosen.slice(1).map((m) => m.id)).toEqual(["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10"]);

    const byPerson = selectContext("What did Ayşe say?", moments, { now: NOW });
    // Both mention Ayşe; the newer one comes first.
    expect(byPerson.slice(0, 2).map((m) => m.id)).toEqual(["ayse", "venue"]);
  });

  it("finds Turkish words through their suffixes", () => {
    const moments = [
      moment("t", 30, { language: "tr", title: "Bütçe toplantısı", transcript: "Toplantıda bütçeyi Perşembe'ye aldık.", people: ["Mert"] }),
      ...Array.from({ length: 14 }, (_, i) => moment(`x${i}`, i)),
    ];
    expect(selectContext("toplanti ne zaman", moments, { now: NOW })[0]!.id).toBe("t");
    expect(selectContext("Mert'le ne konuştuk?", moments, { now: NOW })[0]!.id).toBe("t");
  });

  it("reads the time a question names", () => {
    const yesterday = timeWindow("What was decided yesterday?", NOW)!;
    expect(new Date(yesterday.from).getDate()).toBe(1);
    expect(yesterday.to - yesterday.from).toBe(86_400_000);
    expect(timeWindow("Bugün ne yaptım?", NOW)).not.toBeNull();
    expect(timeWindow("dün akşam kim aradı", NOW)).not.toBeNull();
    expect(timeWindow("What about the deck?", NOW)).toBeNull();

    const moments = [
      moment("today", 1),
      moment("yesterday-morning", 30),
      moment("last-week", 24 * 8),
    ];
    expect(selectContext("What happened yesterday?", moments, { now: NOW })[0]!.id).toBe("yesterday-morning");
  });

  it("always sends the moment a question was asked from, and the ones the last answer cited", () => {
    const moments = Array.from({ length: 30 }, (_, i) => moment(`m${i}`, i));
    const chosen = selectContext("And when is it due?", moments, { now: NOW, focusId: "m29", recentCites: ["m25"] });
    expect(chosen[0]!.id).toBe("m29");
    expect(chosen[1]!.id).toBe("m25");
    expect(chosen).toHaveLength(MAX_CONTEXT);
  });

  it("sends at most twelve, trimmed to the contract, and the request it builds is valid", () => {
    const long = "word ".repeat(3000);
    const moments = Array.from({ length: 40 }, (_, i) =>
      moment(`m${i}`, i, { transcript: i === 7 ? `budget ${long}` : long, title: i === 7 ? "Budget" : "x".repeat(200), people: Array(12).fill("Someone") }),
    );
    const context = buildContext("budget", moments, { now: NOW });
    expect(context).toHaveLength(12);
    expect(context[0]!.id).toBe("m7");
    expect(context[0]!.transcript.length).toBeLessThanOrEqual(4000);
    expect(context[0]!.transcript.length).toBeGreaterThan(3000);
    // The ones that only fill places carry less of what was said.
    expect(context[1]!.transcript.length).toBeLessThanOrEqual(800);
    expect(context.reduce((n, c) => n + c.transcript.length, 0)).toBeLessThanOrEqual(24_000);
    const parsed = AgentRequestSchema.safeParse({
      messages: [{ role: "user", text: "budget" }],
      moments: context,
      now: "Monday 2 November 2026 at 15:00 (2026-11-02T15:00+03:00)",
      timeZone: "Europe/Istanbul",
      replyLang: "en",
      speak: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("leaves out a place that is only coordinates", () => {
    expect(toContext(moment("a", 1, { place: { name: "41.0430, 29.0094", lat: 41.043, lon: 29.0094 } })).place).toBeNull();
    expect(toContext(moment("a", 1, { place: { name: "Moda, Kadıköy", lat: 40.98, lon: 29.03 } })).place).toBe("Moda, Kadıköy");
  });
});

describe("feed search and filters", () => {
  const a = moment("a", 1, { title: "Launch deck", people: ["Ayşe", "Mert"], topics: ["launch"] });
  const b = moment("b", 2, { title: "Toplantı", people: ["ayşe"], topics: ["bütçe"], transcript: "Perşembe günü toplantıda" });

  it("needs every word of the query, by prefix, with or without Turkish letters", () => {
    expect(momentMatches(a, "")).toBe(true);
    expect(momentMatches(a, "launch dec")).toBe(true);
    expect(momentMatches(a, "launch budget")).toBe(false);
    expect(momentMatches(b, "toplanti persembe")).toBe(true);
  });

  it("counts people and topics across moments, spellings that fold alike as one", () => {
    const f = facetsOf([a, b]);
    expect(f.people[0]).toMatchObject({ value: "Ayşe", count: 2 });
    expect(f.people.map((p) => p.value)).toEqual(["Ayşe", "Mert"]);
    expect(f.topics.map((t) => t.value).sort()).toEqual(["bütçe", "launch"]);
    expect(hasFacet(b, { kind: "person", value: "Ayşe" })).toBe(true);
    expect(hasFacet(a, { kind: "topic", value: "bütçe" })).toBe(false);
  });
});
