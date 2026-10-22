import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ThinkingMode } from "@/lib/server/env";
import {
  ProviderError,
  type AssistantReplyParams,
  type ExtractParams,
  type LlmEvent,
  type LlmProvider,
} from "./types";

/**
 * Claude through the official SDK.
 *
 * Voice replies: streamed, thinking at its lowest setting ("between_tools" on
 * claude-sonnet-5-5, configurable with LLM_THINKING) and effort "low", because
 * time to first token is most of the latency budget. The one tool,
 * search_notes, is executed here and the loop continues until the model
 * answers. Thinking blocks the model returns inside a turn are passed back
 * unchanged; across turns the history is plain text built by the caller, so
 * there is never an edited block to replay.
 *
 * Refusals: stop_reason "refusal" is checked before reading content, and the
 * server side fallback (fallbacks: "default") is on unless LLM_FALLBACKS=off.
 */

const SEARCH_NOTES: Anthropic.Beta.Messages.BetaTool = {
  name: "search_notes",
  description:
    "Search the user's own notes, which summarize their earlier recordings. Use it whenever the user asks " +
    "about something they said, recorded, noted, planned, agreed or were told before, or mentions their " +
    "notes, meetings, action items, or people from earlier conversations. Not for general knowledge.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A few keywords for what to look for, in the language the notes are likely written in",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  // Streamed requests with client tools stream tool input eagerly; the input
  // is therefore validated here, not by the API.
  eager_input_streaming: true,
};

const SearchNotesInput = z.object({ query: z.string().trim().min(1).max(200) });

/** Several sequential searches would only add latency to a spoken answer. */
const MAX_TOOL_ROUNDS = 2;

const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  notesModel: string;
  thinking: ThinkingMode;
  effort: "low" | "medium" | "high";
  fallbacks: string;
}

export class AnthropicLlm implements LlmProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly opts: AnthropicOptions) {
    this.model = opts.model;
    // One retry at most: on a voice turn a second retry costs more time than
    // the user will wait.
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 30_000 });
  }

  private fallbackParams(model: string): { betas?: string[]; fallbacks?: "default" } {
    if (this.opts.fallbacks !== "default" || !FALLBACK_MODELS.has(model)) return {};
    return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
  }

  async *streamAssistantReply(params: AssistantReplyParams): AsyncIterable<LlmEvent> {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      ...params.history.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: params.user },
    ];
    // Thinking tokens count toward max_tokens, so leave room when it is on.
    const maxTokens = this.opts.thinking === "adaptive" ? params.maxTokens + 4000 : params.maxTokens;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let round = 0; ; round++) {
      const allowTools = !!params.tools && round < MAX_TOOL_ROUNDS;
      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        const stream = this.client.beta.messages.stream(
          {
            model: this.model,
            max_tokens: maxTokens,
            system: params.system,
            messages,
            // The tool list stays the same for the whole turn; on the last
            // round the model is told in the prompt to answer instead.
            ...(params.tools ? { tools: [SEARCH_NOTES] } : {}),
            thinking: { type: this.opts.thinking } as Anthropic.Beta.Messages.BetaThinkingConfigParam,
            output_config: { effort: this.opts.effort },
            ...this.fallbackParams(this.model),
          },
          { signal: params.signal },
        );
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", delta: event.delta.text };
          }
        }
        message = await stream.finalMessage();
      } catch (err) {
        throw toProviderError(err);
      }

      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;

      if (message.stop_reason === "refusal") {
        yield { type: "refusal" };
        return;
      }

      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
      );
      if (message.stop_reason !== "tool_use" || toolUses.length === 0 || !params.tools) {
        yield { type: "done", stopReason: message.stop_reason ?? "end_turn", inputTokens, outputTokens };
        return;
      }

      // Thinking blocks and progress notes go back exactly as received.
      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        yield { type: "tool_start", name: use.name };
        const input = SearchNotesInput.safeParse(use.input);
        let content: string;
        let isError = false;
        if (use.name !== "search_notes" || !input.success) {
          content = JSON.stringify({ error: "invalid input", expected: { tool: "search_notes", input: { query: "string" } } });
          isError = true;
        } else if (!allowTools) {
          content = "Search limit reached for this question. Answer with what you already have.";
          isError = true;
        } else {
          try {
            content = await params.tools.searchNotes(input.data.query);
          } catch {
            content = "Notes search is unavailable right now.";
            isError = true;
          }
        }
        yield { type: "tool_end", name: use.name, ok: !isError };
        results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
      }
      // All results of one assistant turn go back in a single user message.
      messages.push({ role: "user", content: results });
    }
  }

  async extractStructured<T>(params: ExtractParams<T>): Promise<T | null> {
    try {
      const response = await this.client.beta.messages.parse(
        {
          model: this.opts.notesModel,
          max_tokens: params.maxTokens ?? 8000,
          system: params.system,
          messages: [{ role: "user", content: params.user }],
          output_config: { format: zodOutputFormat(params.schema), effort: "low" },
          ...this.fallbackParams(this.opts.notesModel),
        },
        { signal: params.signal, maxRetries: 2, timeout: 60_000 },
      );
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
      return (response.parsed_output as T | null | undefined) ?? null;
    } catch (err) {
      // A body that does not parse against the schema is a validation miss,
      // which the caller retries; anything else is a provider failure.
      if (err instanceof Anthropic.APIError || isAbort(err)) throw toProviderError(err);
      return null;
    }
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Anthropic.APIUserAbortError || (err instanceof Error && err.name === "AbortError");
}

/** Maps SDK errors to codes. Messages from the API are not forwarded. */
function toProviderError(err: unknown): Error {
  if (isAbort(err)) return err as Error;
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("anthropic", "rate_limited", 429);
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError("anthropic", "auth", 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError("anthropic", "forbidden", 403);
  if (err instanceof Anthropic.NotFoundError) return new ProviderError("anthropic", "model_not_found", 404);
  if (err instanceof Anthropic.BadRequestError) return new ProviderError("anthropic", "bad_request", 400);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("anthropic", "timeout");
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("anthropic", "network");
  if (err instanceof Anthropic.APIError) return new ProviderError("anthropic", "upstream", err.status ?? null);
  return new ProviderError("anthropic", "unknown");
}
