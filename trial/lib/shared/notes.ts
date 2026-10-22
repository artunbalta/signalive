import { z } from "zod";
import type { Note, NoteContent } from "./types";

/**
 * What the model is asked to produce. Kept free of length and count
 * constraints because structured output supports only part of JSON Schema;
 * the limits are enforced by NoteContentSchema after the call.
 */
export const NoteContentWireSchema = z.object({
  title: z.string().describe("At most 8 words, in the language of the transcript"),
  summary: z.string().describe("2 to 4 plain sentences"),
  action_items: z.array(z.string()).describe("Concrete things someone said they or others will do; empty if none"),
  topics: z.array(z.string()).describe("1 to 5 short topic labels"),
  people_mentioned: z.array(z.string()).describe("Names of people mentioned; empty if none"),
  language: z.enum(["en", "tr"]),
});

/** The contract every stored note satisfies. */
export const NoteContentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  action_items: z.array(z.string().trim().min(1).max(300)).max(20),
  topics: z.array(z.string().trim().min(1).max(60)).max(10),
  people_mentioned: z.array(z.string().trim().min(1).max(80)).max(20),
  language: z.enum(["en", "tr"]),
}) satisfies z.ZodType<NoteContent>;

/**
 * Search folding: lowercase by Turkish rules, then drop every diacritic and
 * map ı to i. People often type Turkish without Turkish letters ("isik" for
 * "ışık"), so search is deliberately more forgiving than WER scoring.
 * Note text and queries go through the same function.
 */
export function searchFold(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’‘ʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function noteSearchText(n: NoteContent): string {
  return searchFold(
    [n.title, n.summary, ...n.action_items, ...n.topics, ...n.people_mentioned].join(" "),
  );
}

export function noteEmbeddingText(n: NoteContent): string {
  return [
    n.title,
    n.summary,
    n.action_items.length ? `Action items: ${n.action_items.join("; ")}` : "",
    n.topics.length ? `Topics: ${n.topics.join(", ")}` : "",
    n.people_mentioned.length ? `People: ${n.people_mentioned.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Builds a Postgres tsquery: every word must match as a prefix, so
 * "toplanti" finds "toplantida". Words are folded to letters and digits only,
 * so nothing in the result is tsquery syntax. Null when nothing is left.
 */
export function buildTsQuery(query: string): string | null {
  const words = [...new Set(searchFold(query).split(" ").filter((w) => w.length >= 2 || /\d/.test(w)))].slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(" & ") : null;
}

/** Plain text block handed to the assistant when it searches notes. */
export function notesForPrompt(notes: Note[]): string {
  if (notes.length === 0) return "No matching notes.";
  return notes
    .map((n, i) => {
      const lines = [
        `[${i + 1}] ${n.title} (${n.createdAt.slice(0, 16).replace("T", " ")} UTC)`,
        n.summary,
        n.action_items.length ? `Action items: ${n.action_items.join("; ")}` : "",
        n.people_mentioned.length ? `People: ${n.people_mentioned.join(", ")}` : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
}
