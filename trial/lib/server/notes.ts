import "server-only";
import { guessLanguage } from "@/lib/shared/lang-detect";
import { noteEmbeddingText, NoteContentSchema, NoteContentWireSchema } from "@/lib/shared/notes";
import type { Note, NoteContent, NoteSource } from "@/lib/shared/types";
import { HttpError } from "./http";
import { logError, logMetric } from "./log";
import { NOTES_RETRY_HINT, NOTES_SYSTEM_PROMPT, notesUserMessage } from "./prompts";
import type { EmbeddingProvider, LlmProvider } from "./providers/types";
import type { UserStore } from "./store/types";

export interface MakeNoteParams {
  sessionId: string | null;
  source: NoteSource;
  from?: string;
  to?: string;
  markId?: string;
  signal?: AbortSignal;
}

/**
 * Turns the recorder utterances in a window into one structured note.
 * The model's output must pass NoteContentSchema; after one failed attempt it
 * is asked once more, and after a second failure nothing is stored. The note
 * is embedded for semantic search; if that fails it is still stored and stays
 * findable by its words.
 */
export async function makeNote(
  store: UserStore,
  llm: LlmProvider,
  embeddings: EmbeddingProvider,
  p: MakeNoteParams,
): Promise<Note> {
  const utterances = await store.listUtterances({
    sessionId: p.sessionId ?? undefined,
    from: p.from,
    to: p.to,
    source: "recorder",
    limit: 400,
  });
  if (utterances.length === 0) throw new HttpError(422, "nothing_to_summarize");

  const lines = utterances.map((u) => ({ at: u.startedAt.slice(11, 19), text: u.text }));
  const user = notesUserMessage(lines, p.source === "mark");

  let content: NoteContent | null = null;
  for (let attempt = 0; attempt < 2 && !content; attempt++) {
    const raw = await llm.extractStructured({
      system: NOTES_SYSTEM_PROMPT,
      user: attempt === 0 ? user : user + NOTES_RETRY_HINT,
      schema: NoteContentWireSchema,
      signal: p.signal,
    });
    const parsed = NoteContentSchema.safeParse(raw);
    if (parsed.success) content = parsed.data;
    else logMetric("notes.invalid", { attempt, model: llm.model });
  }
  if (!content) throw new HttpError(502, "notes_invalid");

  // If every utterance was recognized in one language and the model said
  // otherwise, the recognizer is the better witness.
  const transcriptLang = guessLanguage(lines.map((l) => l.text).join(" "), content.language);
  if (transcriptLang !== content.language && utterances.every((u) => u.language === transcriptLang)) {
    content = { ...content, language: transcriptLang };
  }

  let embedding: { model: string; vector: number[] } | null = null;
  try {
    const [vector] = await embeddings.embed([noteEmbeddingText(content)], "document", p.signal);
    if (vector) embedding = { model: embeddings.model, vector };
  } catch (err) {
    logError("notes.embed", err, { provider: embeddings.id });
  }

  const note = await store.insertNote(
    {
      ...content,
      sessionId: p.sessionId,
      source: p.source,
      periodStart: utterances[0]!.startedAt,
      periodEnd: utterances.at(-1)!.endedAt,
      utteranceIds: utterances.map((u) => u.id),
      model: llm.model,
    },
    embedding,
  );
  if (p.markId) await store.attachNoteToMark(p.markId, note.id);
  logMetric("notes.made", { utterances: utterances.length, source: p.source, embedded: !!embedding });
  return note;
}
