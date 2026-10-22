import "server-only";
import { buildTsQuery, notesForPrompt } from "@/lib/shared/notes";
import type { NoteSearchHit, SearchMode } from "@/lib/shared/types";
import { getEmbeddings } from "@/lib/server/providers";
import type { UserStore } from "@/lib/server/store/types";
import { logError } from "@/lib/server/log";

/**
 * Hybrid note search: prefix full text plus embeddings, fused by rank. If the
 * embedding call fails, the text half still answers.
 */
export async function searchUserNotes(
  store: UserStore,
  query: string,
  opts: { mode?: SearchMode; limit?: number; signal?: AbortSignal } = {},
): Promise<NoteSearchHit[]> {
  const mode = opts.mode ?? "hybrid";
  const limit = opts.limit ?? 10;
  const tsquery = mode === "semantic" ? null : buildTsQuery(query);
  let embedding: number[] | null = null;
  const provider = getEmbeddings();
  if (mode !== "text" && query.trim()) {
    try {
      [embedding] = (await provider.embed([query], "query", opts.signal)) as [number[]];
    } catch (err) {
      logError("notes.search.embed", err, { provider: provider.id });
      if (mode === "semantic") throw err;
    }
  }
  if (!tsquery && !embedding) return [];
  return store.searchNotes({ tsquery, embedding, embeddingModel: embedding ? provider.model : null, limit });
}

/** The assistant's search_notes tool. */
export async function searchNotesForAssistant(store: UserStore, query: string, signal?: AbortSignal): Promise<string> {
  const hits = await searchUserNotes(store, query, { limit: 5, signal });
  return notesForPrompt(hits.map((h) => h.note));
}
