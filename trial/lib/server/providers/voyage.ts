import "server-only";
import { EMBEDDING_DIMS } from "@/lib/shared/types";
import { providerFetch } from "./http";
import type { EmbeddingProvider } from "./types";

/** Voyage embeddings; query and document inputs get their retrieval prompts. */
export class VoyageEmbeddings implements EmbeddingProvider {
  readonly id = "voyage" as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async embed(texts: string[], kind: "query" | "document", signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await providerFetch("voyage", "https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: texts.map((t) => t || " "),
        model: this.model,
        input_type: kind,
        output_dimension: EMBEDDING_DIMS,
      }),
      signal,
      timeoutMs: 15_000,
    });
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const out: number[][] = new Array(texts.length);
    for (const d of json.data ?? []) out[d.index] = d.embedding;
    return out;
  }
}
