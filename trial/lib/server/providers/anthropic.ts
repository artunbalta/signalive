import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ThinkingMode } from "@/lib/server/env";
import {
  ProviderError,
  type AgentReplyParams,
  type AgentTool,
  type AgentToolResult,
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
 * Agent turns (the moments agent) use the same request with the caller's
 * tools: each is streamed eagerly, so its input is validated here before it
 * runs, and the loop is capped.
 *
 * Refusals: stop_reason "refusal" is checked before reading content, and the
 * server side fallback (fallbacks: "default") is on unless LLM_FALLBACKS=off.
 * After a fallback in the middle of a turn, the declining model's thinking
 * and tool calls before the fallback marker are neither run nor echoed back.
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

type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export class AnthropicLlm implements LlmProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;

  /** client: tests pass a stand-in; otherwise one is made from the options. */
  constructor(
    private readonly opts: AnthropicOptions,
    client?: Anthropic,
  ) {
    this.model = opts.model;
    // One retry at most: on a voice turn a second retry costs more time than
    // the user will wait.
    this.client = client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 30_000 });
  }

  private fallbackParams(model: string): { betas?: string[]; fallbacks?: "default" } {
    if (this.opts.fallbacks !== "default" || !FALLBACK_MODELS.has(model)) return {};
    return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
  }

  /** One streamed request of a voice or agent turn. */
  private stream(
    system: string,
    messages: MessageParam[],
    tools: Anthropic.Beta.Messages.BetaTool[] | undefined,
    maxTokens: number,
    signal?: AbortSignal,
  ) {
    return this.client.beta.messages.stream(
      {
        model: this.model,
        // Thinking tokens count toward max_tokens, so leave room when it is on.
        max_tokens: this.opts.thinking === "adaptive" ? maxTokens + 4000 : maxTokens,
        system,
        messages,
        // The tool list stays the same for the whole turn; past the last
        // round the model is told in a tool result to answer instead.
        ...(tools ? { tools } : {}),
        thinking: { type: this.opts.thinking } as Anthropic.Beta.Messages.BetaThinkingConfigParam,
        output_config: { effort: this.opts.effort },
        ...this.fallbackParams(this.model),
      },
      { signal },
    );
  }

  async *streamAssistantReply(params: AssistantReplyParams): AsyncIterable<LlmEvent> {
    const messages: MessageParam[] = [
      ...params.history.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: params.user },
    ];
    let inputTokens = 0;
    let outputTokens = 0;

    for (let round = 0; ; round++) {
      const allowTools = !!params.tools && round < MAX_TOOL_ROUNDS;
      let message: Message;
      try {
        const stream = this.stream(params.system, messages, params.tools ? [SEARCH_NOTES] : undefined, params.maxTokens, params.signal);
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

      const blocks = afterFallback(message.content);
      const toolUses = blocks.filter(isToolUse);
      if (message.stop_reason !== "tool_use" || toolUses.length === 0 || !params.tools) {
        yield { type: "done", stopReason: message.stop_reason ?? "end_turn", inputTokens, outputTokens, model: message.model };
        return;
      }

      // Thinking blocks and progress notes go back exactly as received.
      messages.push({ role: "assistant", content: blocks });
      const results: ToolResult[] = [];
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

  /**
   * Rounds 0 to maxToolRounds - 1 run the model's tool calls. Calls in the
   * round after get a result telling the model to answer with what it has,
   * and calls after that end the turn: at most maxToolRounds + 2 requests.
   */
  async *streamAgentReply(params: AgentReplyParams): AsyncIterable<LlmEvent> {
    const tools = params.tools.map(claudeTool);
    const messages: MessageParam[] = [
      ...params.history.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: params.user },
    ];
    let inputTokens = 0;
    let outputTokens = 0;
    let lastChar = "";
    let jsonRetries = 0;

    for (let round = 0; ; round++) {
      // Tool calls this round, by block id, announced as the model begins them.
      const announced = new Map<string, string>();
      let said = false;
      let roundText = "";
      let message: Message;
      try {
        const stream = this.stream(params.system, messages, tools, params.maxTokens, params.signal);
        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            announced.set(event.content_block.id, event.content_block.name);
            yield { type: "tool_start", name: event.content_block.name };
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
            said = true;
            roundText += event.delta.text;
            lastChar = event.delta.text.at(-1)!;
            yield { type: "text", delta: event.delta.text };
          }
        }
        message = await stream.finalMessage();
      } catch (err) {
        // Tool input that is not JSON at all fails the stream when its block
        // ends: with eager streaming the API leaves that check to the client.
        // The round is asked again, once, if none of it was said yet.
        if (isBadToolJson(err) && !said && jsonRetries++ === 0) {
          for (const name of announced.values()) yield { type: "tool_end", name, ok: false };
          round--;
          continue;
        }
        throw toProviderError(err);
      }

      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;

      // A refusal can cut a call off halfway: nothing of this round runs.
      if (message.stop_reason === "refusal") {
        for (const name of announced.values()) yield { type: "tool_end", name, ok: false };
        yield { type: "refusal" };
        return;
      }

      // Calls run only when the model stopped for them (max_tokens can cut
      // one off), after any fallback marker, and while rounds are left.
      const blocks = afterFallback(message.content);
      const runnable = message.stop_reason === "tool_use" && round <= params.maxToolRounds ? blocks.filter(isToolUse) : [];
      const runs = new Set(runnable.map((u) => u.id));
      for (const [id, name] of announced) if (!runs.has(id)) yield { type: "tool_end", name, ok: false };
      if (runnable.length === 0) {
        yield { type: "done", stopReason: message.stop_reason ?? "end_turn", inputTokens, outputTokens, model: message.model };
        return;
      }

      // What the model says after the tools starts on a new line, so the
      // sentence it said before them can go to speech now.
      if (lastChar && !/\s/.test(lastChar)) {
        lastChar = "\n";
        yield { type: "text", delta: "\n" };
      }

      // Thinking blocks and progress notes go back exactly as received.
      messages.push({ role: "assistant", content: blocks });
      const results: ToolResult[] = [];
      for (const use of runnable) {
        if (!announced.has(use.id)) yield { type: "tool_start", name: use.name };
        const result = await runTool(use, params.tools, round < params.maxToolRounds);
        yield { type: "tool_end", name: use.name, ok: !result.isError };
        results.push({ type: "tool_result", tool_use_id: use.id, content: result.content, ...(result.isError ? { is_error: true } : {}) });
      }
      // An answer followed only by calls that end the turn (a citation, or a
      // proposal the answer announced) is complete: asked again, the model
      // would say it a second time, or talk about having said it.
      const answered = roundText.trim().length >= (params.answeredChars ?? Infinity);
      const ends = (u: ToolUse) => {
        const tool = findTool(params.tools, u.name);
        return Boolean(tool?.endsTurn || (answered && tool?.endsTurnAfterAnswer));
      };
      if (said && results.every((r) => !r.is_error) && runnable.every(ends)) {
        yield { type: "done", stopReason: "tool_use", inputTokens, outputTokens, model: message.model };
        return;
      }
      // All results of one assistant turn go back in a single user message,
      // with a note after them when the answer came before the calls: told
      // nothing, the model tends to give the whole answer a second time.
      const content: (ToolResult | Anthropic.Beta.Messages.BetaTextBlockParam)[] = [...results];
      if (roundText.trim().length >= (params.answeredChars ?? Infinity)) content.push({ type: "text", text: ALREADY_ANSWERED });
      messages.push({ role: "user", content });
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
      if (params.outcome) params.outcome.model = response.model;
      return (response.parsed_output as T | null | undefined) ?? null;
    } catch (err) {
      // A body that does not parse against the schema is a validation miss,
      // which the caller retries; anything else is a provider failure.
      if (err instanceof Anthropic.APIError || isAbort(err)) throw toProviderError(err);
      return null;
    }
  }
}

const ALREADY_ANSWERED =
  "The wearer has already heard everything you wrote before these tool calls. Do not repeat it and do not comment on it or on these results. If something in the results answers their question further, say only that, in one short sentence; otherwise write nothing.";

/** A tool as Claude takes it. Every one is streamed eagerly; runTool validates what arrives. */
function claudeTool(tool: AgentTool): Anthropic.Beta.Messages.BetaTool {
  const { $schema: _, ...schema } = z.toJSONSchema(tool.input) as Anthropic.Beta.Messages.BetaTool.InputSchema;
  return { name: tool.name, description: tool.description, input_schema: schema, eager_input_streaming: true };
}

/** "Find_Moments" or "find_moment" are taken to mean find_moments. */
const toolKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");

const findTool = (tools: AgentTool[], name: string) =>
  tools.find((t) => t.name === name) ?? tools.find((t) => toolKey(t.name) === toolKey(name));

async function runTool(use: ToolUse, tools: AgentTool[], allowed: boolean): Promise<AgentToolResult> {
  const tool = findTool(tools, use.name);
  if (!tool) return { content: JSON.stringify({ error: "unknown tool", tools: tools.map((t) => t.name) }), isError: true };
  // The SDK's tolerant parser can hand back a silently truncated object, so
  // the schema is checked here; a miss goes back to the model to fix.
  const input = tool.input.safeParse(use.input);
  if (!input.success) {
    const issues = input.error.issues.slice(0, 5).map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`);
    return { content: JSON.stringify({ INVALID_JSON: JSON.stringify(use.input ?? null), issues }), isError: true };
  }
  if (!allowed) return { content: "Tool limit reached for this question. Answer the wearer now with what you already have.", isError: true };
  try {
    return await tool.run(input.data);
  } catch (err) {
    if (isAbort(err)) throw err;
    return { content: `${tool.name} is unavailable right now.`, isError: true };
  }
}

const isToolUse = (b: ContentBlock): b is ToolUse => b.type === "tool_use";

/**
 * After a fallback in the middle of a response, the blocks before the last
 * fallback marker came from the model that declined: its text stays as
 * context, its thinking and tool calls are dropped (the API asks for exactly
 * that when the turn is echoed back).
 */
function afterFallback(content: ContentBlock[]): ContentBlock[] {
  const marker = content.findLastIndex((b) => b.type === "fallback");
  return marker < 0 ? content : content.filter((b, i) => i >= marker || b.type === "text");
}

/** The SDK's own error for tool input it could not parse at all. API errors (aborts included) are subclasses and excluded. */
function isBadToolJson(err: unknown): boolean {
  return err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError);
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
