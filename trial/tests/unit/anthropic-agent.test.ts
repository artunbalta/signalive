import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicLlm } from "@/lib/server/providers/anthropic";
import type { AgentReplyParams, AgentTool, LlmEvent } from "@/lib/server/providers/types";

/**
 * The Claude agent loop against a stand-in for the SDK client: each request
 * gets the next scripted response, streamed as the SDK streams it. What the
 * loop sends is recorded, so the tests can read the requests back.
 */

type Block = Record<string, unknown> & { type: string };
type Scripted = { blocks: Block[]; stop: string; model?: string } | { throws: Error; said?: string };

function fakeClient(script: Scripted[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          // A copy: the loop goes on appending to the same messages array.
          requests.push(structuredClone(params));
          const next = script.shift();
          if (!next) throw new Error("no scripted response left");
          const events = (async function* () {
            if ("throws" in next) {
              if (next.said) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: next.said } };
              throw next.throws;
            }
            for (const [index, block] of next.blocks.entries()) {
              if (block.type === "tool_use") yield { type: "content_block_start", index, content_block: { ...block, input: {} } };
              if (block.type === "text") yield { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } };
            }
          })();
          let final: unknown;
          return {
            async *[Symbol.asyncIterator]() {
              yield* events;
              if (!("throws" in next)) {
                final = { model: next.model ?? "claude-sonnet-5-5", stop_reason: next.stop, content: next.blocks, usage: { input_tokens: 10, output_tokens: 5 } };
              }
            },
            async finalMessage() {
              return final;
            },
          };
        },
        async parse() {
          return { stop_reason: "end_turn", model: "claude-sonnet-5", parsed_output: { ok: true } };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

const llm = (client: Anthropic) =>
  new AnthropicLlm(
    { apiKey: "test", model: "claude-sonnet-5-5", notesModel: "claude-sonnet-5-5", thinking: "between_tools", effort: "low", fallbacks: "default" },
    client,
  );

const text = (t: string): Block => ({ type: "text", text: t });
const use = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });

/** Two tools that record their calls. */
function tools() {
  const ran: { name: string; input: unknown }[] = [];
  const make = (name: string, input: z.ZodType): AgentTool => ({
    name,
    description: `The ${name} tool.`,
    input,
    async run(i) {
      ran.push({ name, input: i });
      return { content: `${name} ran` };
    },
  });
  return {
    ran,
    list: [
      make("find_moments", z.object({ query: z.string().min(1) })),
      make("create_reminder", z.object({ text: z.string().min(1).max(240), momentId: z.string().nullable().optional() })),
    ],
  };
}

const params = (list: AgentTool[], over: Partial<AgentReplyParams> = {}): AgentReplyParams => ({
  system: "system",
  history: [{ role: "user", text: "Earlier question" }, { role: "assistant", text: "Earlier answer" }],
  user: "Remind me to send the slides",
  tools: list,
  maxToolRounds: 3,
  maxTokens: 1500,
  ...over,
});

async function collect(it: AsyncIterable<LlmEvent>) {
  const out: LlmEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const messagesOf = (request: Record<string, unknown>) => request.messages as { role: string; content: unknown }[];

describe("AnthropicLlm.streamAgentReply", () => {
  it("streams text, announces each call as it starts, runs it, and loops until the answer", async () => {
    const { client, requests } = fakeClient([
      { blocks: [text("Let me look."), use("t1", "find_moments", { query: "slides" })], stop: "tool_use" },
      { blocks: [use("t2", "create_reminder", { text: "Send the slides", momentId: "m1" }), use("t3", "find_moments", { query: "Elif" })], stop: "tool_use" },
      { blocks: [text("I proposed a reminder.")], stop: "end_turn", model: "claude-sonnet-5" },
    ]);
    const t = tools();
    const events = await collect(llm(client).streamAgentReply(params(t.list)));
    expect(events).toEqual([
      { type: "text", delta: "Let me look." },
      { type: "tool_start", name: "find_moments" },
      // The sentence before the tools can go to speech before they run.
      { type: "text", delta: "\n" },
      { type: "tool_end", name: "find_moments", ok: true },
      { type: "tool_start", name: "create_reminder" },
      { type: "tool_start", name: "find_moments" },
      { type: "tool_end", name: "create_reminder", ok: true },
      { type: "tool_end", name: "find_moments", ok: true },
      { type: "text", delta: "I proposed a reminder." },
      { type: "done", stopReason: "end_turn", inputTokens: 30, outputTokens: 15, model: "claude-sonnet-5" },
    ]);
    expect(t.ran.map((r) => r.name)).toEqual(["find_moments", "create_reminder", "find_moments"]);

    // Every tool streams eagerly, with a plain JSON Schema.
    const first = requests[0]!;
    const sent = first.tools as Record<string, unknown>[];
    expect(sent.map((s) => s.name)).toEqual(["find_moments", "create_reminder"]);
    expect(sent.every((s) => s.eager_input_streaming === true)).toBe(true);
    expect(sent[0]!.input_schema).toEqual({
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    });
    // Thinking and effort from the environment, and the refusal fallback.
    expect(first).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 1500,
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(messagesOf(first).map((m) => m.role)).toEqual(["user", "assistant", "user"]);

    // Each round's results go back together, in one user message.
    const third = messagesOf(requests[2]!);
    expect(third).toHaveLength(7);
    expect(third[6]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t2", content: "create_reminder ran" },
        { type: "tool_result", tool_use_id: "t3", content: "find_moments ran" },
      ],
    });
  });

  it("hands input that fails the tool's schema back to the model instead of running it", async () => {
    const { client, requests } = fakeClient([
      { blocks: [use("t1", "create_reminder", { text: "" })], stop: "tool_use" },
      { blocks: [text("What should I remind you of?")], stop: "end_turn" },
    ]);
    const t = tools();
    const events = await collect(llm(client).streamAgentReply(params(t.list)));
    expect(t.ran).toEqual([]);
    expect(events).toContainEqual({ type: "tool_end", name: "create_reminder", ok: false });
    const result = (messagesOf(requests[1]!).at(-1)!.content as Record<string, unknown>[])[0]!;
    expect(result).toMatchObject({ type: "tool_result", tool_use_id: "t1", is_error: true });
    expect(JSON.parse(result.content as string)).toMatchObject({ INVALID_JSON: '{"text":""}', issues: [expect.stringMatching(/^text: /)] });
  });

  it("takes a near miss in a tool's name as meant, and names the tools for an unknown one", async () => {
    const { client, requests } = fakeClient([
      { blocks: [use("t1", "Find_Moments", { query: "slides" }), use("t2", "launch_rocket", {})], stop: "tool_use" },
      { blocks: [text("Done.")], stop: "end_turn" },
    ]);
    const t = tools();
    await collect(llm(client).streamAgentReply(params(t.list)));
    expect(t.ran.map((r) => r.name)).toEqual(["find_moments"]);
    const results = messagesOf(requests[1]!).at(-1)!.content as Record<string, unknown>[];
    expect(JSON.parse(results[1]!.content as string)).toEqual({ error: "unknown tool", tools: ["find_moments", "create_reminder"] });
  });

  it("ends on a refusal without running anything from that response", async () => {
    const { client } = fakeClient([{ blocks: [text("I"), use("t1", "create_reminder", { text: "x" })], stop: "refusal" }]);
    const t = tools();
    const events = await collect(llm(client).streamAgentReply(params(t.list)));
    expect(events.slice(-2)).toEqual([{ type: "tool_end", name: "create_reminder", ok: false }, { type: "refusal" }]);
    expect(t.ran).toEqual([]);
  });

  it("after a fallback marker, neither runs nor echoes back the declining model's calls", async () => {
    const { client, requests } = fakeClient([
      {
        blocks: [
          use("t0", "create_reminder", { text: "half" }),
          { type: "thinking", thinking: "", signature: "s" },
          { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" }, trigger: { type: "refusal" } },
          text("Here you go."),
          use("t1", "find_moments", { query: "slides" }),
        ],
        stop: "tool_use",
      },
      { blocks: [text("Found it.")], stop: "end_turn" },
    ]);
    const t = tools();
    const events = await collect(llm(client).streamAgentReply(params(t.list)));
    expect(t.ran.map((r) => r.name)).toEqual(["find_moments"]);
    expect(events).toContainEqual({ type: "tool_end", name: "create_reminder", ok: false });
    const echoed = messagesOf(requests[1]!).at(-2)!.content as Block[];
    expect(echoed.map((b) => b.type)).toEqual(["fallback", "text", "tool_use"]);
    expect(echoed.at(-1)!.id).toBe("t1");
  });

  it("ends the turn after an answer followed only by calls that end it, and not otherwise", async () => {
    const cited: unknown[] = [];
    const cite: AgentTool = {
      name: "cite_moments",
      description: "Cite.",
      input: z.object({ ids: z.array(z.string()) }),
      endsTurn: true,
      async run(i) {
        cited.push(i);
        return (i as { ids: string[] }).ids.includes("m1") ? { content: "Cited 1." } : { content: "Unknown ids.", isError: true };
      },
    };
    const answered = fakeClient([{ blocks: [text("Friday at three."), use("t1", "cite_moments", { ids: ["m1"] })], stop: "tool_use" }]);
    const events = await collect(llm(answered.client).streamAgentReply(params([cite])));
    expect(answered.requests).toHaveLength(1);
    expect(cited).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "tool_use" });

    // Citing before saying anything, or citing wrongly, goes back to the model.
    const first = fakeClient([
      { blocks: [use("t1", "cite_moments", { ids: ["m1"] })], stop: "tool_use" },
      { blocks: [text("Friday."), use("t2", "cite_moments", { ids: ["zz"] })], stop: "tool_use" },
      { blocks: [text("Friday at three.")], stop: "end_turn" },
    ]);
    await collect(llm(first.client).streamAgentReply(params([cite])));
    expect(first.requests).toHaveLength(3);
  });

  it("tells the model its answer was heard when it came before the calls, and only then", async () => {
    const answer = "The slides are due Thursday, from Elif. I will propose a reminder for Thursday at five.";
    const { client, requests } = fakeClient([
      { blocks: [text(answer), use("t1", "create_reminder", { text: "Check the slides" })], stop: "tool_use" },
      { blocks: [text("Proposed.")], stop: "end_turn" },
    ]);
    await collect(llm(client).streamAgentReply(params(tools().list, { answeredChars: 40 })));
    const results = messagesOf(requests[1]!).at(-1)!.content as { type: string; text?: string }[];
    expect(results.map((b) => b.type)).toEqual(["tool_result", "text"]);
    expect(results[1]!.text).toMatch(/already heard/);

    // A few words before a call are not the answer: no note.
    const short = fakeClient([
      { blocks: [text("Let me look."), use("t1", "find_moments", { query: "slides" })], stop: "tool_use" },
      { blocks: [text(answer)], stop: "end_turn" },
    ]);
    await collect(llm(short.client).streamAgentReply(params(tools().list, { answeredChars: 40 })));
    expect((messagesOf(short.requests[1]!).at(-1)!.content as { type: string }[]).map((b) => b.type)).toEqual(["tool_result"]);
  });

  it("ends the turn after a proposal the answer announced, but not after a few words", async () => {
    const answer = "The slides are due Thursday, from Elif. I have proposed a reminder for Thursday at five.";
    const proposing = () => {
      const t = tools();
      return { ...t, list: t.list.map((tool) => (tool.name === "create_reminder" ? { ...tool, endsTurnAfterAnswer: true } : tool)) };
    };
    const t = proposing();
    const { client, requests } = fakeClient([{ blocks: [text(answer), use("t1", "create_reminder", { text: "Check the slides" })], stop: "tool_use" }]);
    const events = await collect(llm(client).streamAgentReply(params(t.list, { answeredChars: 40 })));
    expect(requests).toHaveLength(1);
    expect(t.ran.map((r) => r.name)).toEqual(["create_reminder"]);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "tool_use" });

    // "Sure." is not the answer: the model is asked again for it.
    const u = proposing();
    const short = fakeClient([
      { blocks: [text("Sure."), use("t1", "create_reminder", { text: "Check the slides" })], stop: "tool_use" },
      { blocks: [text(answer)], stop: "end_turn" },
    ]);
    await collect(llm(short.client).streamAgentReply(params(u.list, { answeredChars: 40 })));
    expect(short.requests).toHaveLength(2);
  });

  it("does not run a call cut off by max_tokens", async () => {
    const { client } = fakeClient([{ blocks: [use("t1", "create_reminder", { text: "Send the sl" })], stop: "max_tokens" }]);
    const t = tools();
    const events = await collect(llm(client).streamAgentReply(params(t.list)));
    expect(t.ran).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "max_tokens" });
  });

  it("runs three rounds of calls, then tells the model to answer, then ends", async () => {
    const again = () => ({ blocks: [use(`t${Math.random()}`, "find_moments", { query: "slides" })], stop: "tool_use" });
    const { client, requests } = fakeClient([again(), again(), again(), again(), again(), again()]);
    const t = tools();
    const events = await collect(llm(client).streamAgentReply(params(t.list)));
    expect(requests).toHaveLength(5);
    expect(t.ran).toHaveLength(3);
    const limited = (messagesOf(requests[4]!).at(-1)!.content as Record<string, unknown>[])[0]!;
    expect(limited).toMatchObject({ is_error: true, content: expect.stringContaining("Tool limit reached") });
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "tool_use" });
  });

  it("asks again once when tool input is not JSON at all, but not after it has spoken", async () => {
    const unparseable = () => new Anthropic.AnthropicError("Unable to parse tool parameter JSON from model.");
    const { client, requests } = fakeClient([{ throws: unparseable() }, { blocks: [text("Answer.")], stop: "end_turn" }]);
    const events = await collect(llm(client).streamAgentReply(params(tools().list)));
    expect(requests).toHaveLength(2);
    expect(events).toContainEqual({ type: "text", delta: "Answer." });

    const spoke = fakeClient([{ throws: unparseable(), said: "Sure." }]);
    await expect(collect(llm(spoke.client).streamAgentReply(params(tools().list)))).rejects.toMatchObject({
      name: "ProviderError",
      code: "unknown",
    });
  });

  it("maps API errors to provider codes", async () => {
    const limited = new Anthropic.RateLimitError(429, undefined, "slow down", new Headers());
    const { client } = fakeClient([{ throws: limited }]);
    await expect(collect(llm(client).streamAgentReply(params(tools().list)))).rejects.toMatchObject({ code: "rate_limited", status: 429 });
  });
});

describe("AnthropicLlm.extractStructured", () => {
  it("reports the model that wrote the output", async () => {
    const { client } = fakeClient([]);
    const outcome = { model: "claude-sonnet-5-5" };
    const out = await llm(client).extractStructured({ system: "s", user: "u", schema: z.object({ ok: z.boolean() }), outcome });
    expect(out).toEqual({ ok: true });
    expect(outcome.model).toBe("claude-sonnet-5");
  });
});
