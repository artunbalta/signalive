import { describe, expect, it } from "vitest";
import { agentTools, newSentences, runAgent, withoutPreambles } from "@/lib/server/agent-pipeline";
import { excerpt, queryWords, searchMoments } from "@/lib/server/moments-search";
import { MockLlm, MockTts } from "@/lib/server/providers/mock";
import { ProviderError, type AgentReplyParams, type AgentTool, type LlmEvent, type LlmProvider } from "@/lib/server/providers/types";
import type { AgentMomentContext, AgentRequest, AgentStreamEvent } from "@/lib/shared/moments";

const MOMENTS: AgentMomentContext[] = [
  {
    id: "m2",
    createdAt: "2026-10-30T12:00:00.000Z",
    place: "Kadıköy",
    title: "Bütçe toplantısı Cuma'ya alındı",
    summary: "Bütçe toplantısı Cuma saat üçe alındı. Can mekânı arayacak.",
    keyPoints: ["Cuma saat 15:00"],
    actionItems: [{ text: "Mekânı ara", due: "2026-11-06" }],
    people: ["Can"],
    transcript: "Bütçe toplantısını Cuma saat üçe taşıyalım. Can, mekânı sen ara.",
  },
  {
    id: "m1",
    createdAt: "2026-11-02T11:05:00.000Z",
    place: "Moda, Kadıköy",
    title: "Budget review moved to Friday",
    summary: "The budget meeting moved to Friday at three. Elif will send the slides.",
    keyPoints: ["Friday at 15:00"],
    actionItems: [{ text: "Send the slides", due: "2026-11-05T17:00:00+03:00" }],
    people: ["Elif"],
    transcript: "Let's move the budget review to Friday at three. Elif, can you send the slides by Thursday evening?",
  },
  {
    id: "m3",
    createdAt: "2026-10-28T09:00:00.000Z",
    place: null,
    title: "Car service",
    summary: "The car is in for its service.",
    keyPoints: [],
    actionItems: [],
    people: [],
    transcript: "The garage said the car will be ready on Monday afternoon, and the bill is 4200 lira.",
  },
];

const REQ: AgentRequest = {
  messages: [{ role: "user", text: "What did Elif say about the slides?" }],
  moments: MOMENTS,
  now: "2026-11-02T14:10:00+03:00",
  timeZone: "Europe/Istanbul",
  replyLang: "en",
  speak: false,
};

const deps = (llm: LlmProvider = new MockLlm()) => ({ llm, tts: new MockTts() });

async function collect(gen: AsyncIterable<AgentStreamEvent>) {
  const out: AgentStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** An agent double that records what it was given and answers with a line. */
function recorder(line = "Noted.") {
  const seen: AgentReplyParams[] = [];
  const llm: LlmProvider = {
    id: "mock",
    model: "recorder",
    async *streamAssistantReply() {},
    async extractStructured() {
      return null;
    },
    async *streamAgentReply(p) {
      seen.push(p);
      yield { type: "text", delta: line };
      yield { type: "done", stopReason: "end_turn", inputTokens: null, outputTokens: null };
    },
  };
  return { llm, seen };
}

/** Runs one of the agent's tools the way a provider does: schema first, then run. */
async function call(tools: AgentTool[], name: string, input: unknown) {
  const tool = tools.find((t) => t.name === name)!;
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return { content: "invalid input", isError: true };
  return tool.run(parsed.data);
}

describe("runAgent", () => {
  it("searches, proposes a reminder, cites the moment, and answers, all streamed", async () => {
    const events = await collect(runAgent(REQ, deps(), new AbortController().signal));
    const kinds = events.map((e) => (e.t === "tool" ? `${e.name}:${e.state}` : e.t));
    expect(kinds.slice(0, 8)).toEqual([
      "find_moments:start",
      "find_moments:end",
      "create_reminder:start",
      "action",
      "create_reminder:end",
      "cite_moments:start",
      "cite",
      "cite_moments:end",
    ]);
    expect(events.find((e) => e.t === "action")).toEqual({
      t: "action",
      action: { kind: "reminder", text: "Follow up: Budget review moved to Friday", due: null },
      momentId: "m1",
    });
    expect(events.find((e) => e.t === "cite")).toEqual({ t: "cite", momentIds: ["m1"] });
    expect(events.some((e) => e.t === "audio" || e.t === "sentence")).toBe(false);
    const done = events.at(-1) as Extract<AgentStreamEvent, { t: "done" }>;
    expect(done.t).toBe("done");
    expect(done.reply).toBe(
      'This is a mock agent reply. I looked through your moments and proposed a reminder about "Budget review moved to Friday". No language model was called.',
    );
    expect(done.reply).toBe(events.flatMap((e) => (e.t === "text" ? [e.delta] : [])).join("").trim());
    expect(done.model).toBe("mock-llm");
    expect(done.totalMs).toBeGreaterThan(0);
  });

  it("speaks the reply when asked: sentences and audio, in order, then done", async () => {
    const events = await collect(runAgent({ ...REQ, speak: true }, deps(), new AbortController().signal));
    expect(events.filter((e) => e.t === "sentence").length).toBeGreaterThan(1);
    const audio = events.flatMap((e) => (e.t === "audio" ? [e.i] : []));
    expect(audio.length).toBeGreaterThan(0);
    expect([...audio].sort((a, b) => a - b)).toEqual(audio);
    expect(events.at(-1)!.t).toBe("done");
  });

  it("answers in Turkish when asked, and acts on the newest moment when the words match none", async () => {
    const events = await collect(
      runAgent({ ...REQ, replyLang: "tr", messages: [{ role: "user", text: "xyzzy" }] }, deps(), new AbortController().signal),
    );
    expect(events.find((e) => e.t === "action")).toMatchObject({ action: { text: "Takip et: Budget review moved to Friday" }, momentId: "m1" });
    expect((events.at(-1) as { reply: string }).reply).toMatch(/^Bu bir deneme yanıtı\./);
  });

  it("proposes nothing without moments", async () => {
    const events = await collect(runAgent({ ...REQ, moments: [] }, deps(), new AbortController().signal));
    expect(events.some((e) => e.t === "action" || e.t === "cite")).toBe(false);
    expect((events.at(-1) as { reply: string }).reply).toContain("could not find a moment");
  });

  it("puts the moments in the prompt newest first, without transcripts, and the question last", async () => {
    const { llm, seen } = recorder();
    await collect(
      runAgent(
        {
          ...REQ,
          messages: [
            { role: "assistant", text: "Hello." },
            { role: "user", text: "When is the review?" },
            { role: "assistant", text: "On Friday." },
            { role: "user", text: "  Remind me of it.  " },
          ],
        },
        deps(llm),
        new AbortController().signal,
      ),
    );
    const p = seen[0]!;
    expect(p.user).toBe("Remind me of it.");
    expect(p.history).toEqual([
      { role: "user", text: "When is the review?" },
      { role: "assistant", text: "On Friday." },
    ]);
    expect(p.system).toContain("- Reply in English.");
    expect(p.system).toContain("Your reply is shown as text in the app.");
    expect(p.system).toContain("Monday 2026-11-02T14:10:00+03:00 (Europe/Istanbul)");
    const order = ["m1", "m2", "m3"].map((id) => p.system.indexOf(`<moment id="${id}">`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(p.system).toContain("Kept: Mon, 2 Nov 2026, 14:05, at Moda, Kadıköy");
    expect(p.system).toContain("Action items: Send the slides (due 2026-11-05T17:00:00+03:00)");
    expect(p.system).not.toContain("Thursday evening");
    expect(p.tools.map((t) => t.name)).toEqual(["find_moments", "create_reminder", "create_event", "draft_message", "cite_moments"]);
  });

  it("tells the model it is heard, not read, when the reply is spoken", async () => {
    const { llm, seen } = recorder();
    await collect(runAgent({ ...REQ, speak: true, replyLang: "tr" }, deps(llm), new AbortController().signal));
    expect(seen[0]!.system).toContain("spoken aloud through the earbuds");
    expect(seen[0]!.system).toContain("- Reply in Turkish.");
  });

  it("turns a provider failure into an error event, and a provider without agents into agent_unavailable", async () => {
    const failing: LlmProvider = {
      ...recorder().llm,
      // eslint-disable-next-line require-yield
      async *streamAgentReply() {
        throw new ProviderError("anthropic", "auth", 401);
      },
    };
    expect(await collect(runAgent(REQ, deps(failing), new AbortController().signal))).toEqual([{ t: "error", code: "provider_auth" }]);
    const { streamAgentReply: _, ...plain } = recorder().llm;
    expect(await collect(runAgent(REQ, deps(plain as LlmProvider), new AbortController().signal))).toEqual([
      { t: "error", code: "agent_unavailable" },
    ]);
  });

  it("stops when aborted", async () => {
    const ac = new AbortController();
    const out: AgentStreamEvent[] = [];
    for await (const e of runAgent({ ...REQ, speak: true }, deps(), ac.signal)) {
      out.push(e);
      if (e.t === "action") ac.abort();
    }
    expect(out.some((e) => e.t === "done")).toBe(false);
  });
});

describe("agent tools", () => {
  const setup = () => {
    const emitted: AgentStreamEvent[] = [];
    return { tools: agentTools(REQ, (e) => emitted.push(e)), emitted };
  };

  it("find_moments returns the best matches with ids and what was said", async () => {
    const { tools } = setup();
    const turkish = JSON.parse((await call(tools, "find_moments", { query: "toplanti" })).content);
    expect(turkish.matches.map((m: { id: string }) => m.id)).toEqual(["m2"]);
    expect(turkish.matches[0]).toMatchObject({ kept: "Fri, 30 Oct 2026, 15:00", place: "Kadıköy", matched: expect.arrayContaining(["title"]) });

    const said = JSON.parse((await call(tools, "find_moments", { query: "garage bill" })).content);
    expect(said.matches[0]).toMatchObject({ id: "m3", matched: ["transcript"] });
    expect(said.matches[0].said).toContain("4200 lira");

    const none = JSON.parse((await call(tools, "find_moments", { query: "volcano" })).content);
    expect(none).toEqual({ matches: [], note: "No moment matches these words." });
  });

  it("create_reminder proposes with the wearer's offset, and turns down a time that is not one", async () => {
    const { tools, emitted } = setup();
    const ok = await call(tools, "create_reminder", { text: "Send the slides", due: "2026-11-05T17:00", momentId: "m1" });
    expect(ok.isError).toBeFalsy();
    expect(ok.content).toContain("nothing happens until they do");
    expect(emitted).toEqual([
      { t: "action", action: { kind: "reminder", text: "Send the slides", due: "2026-11-05T17:00:00+03:00" }, momentId: "m1" },
    ]);
    const bad = await call(tools, "create_reminder", { text: "Send the slides", due: "Thursday evening" });
    expect(bad.isError).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it("create_event needs a start with a time, and an end after it; an unknown moment becomes none", async () => {
    const { tools, emitted } = setup();
    expect((await call(tools, "create_event", { title: "Budget review", start: "2026-11-06" })).isError).toBe(true);
    expect(
      (await call(tools, "create_event", { title: "Budget review", start: "2026-11-06T15:00", end: "2026-11-06T14:00" })).isError,
    ).toBe(true);
    const ok = await call(tools, "create_event", {
      title: "Budget review",
      start: "2026-11-06T15:00",
      end: "2026-11-06T16:00:00+03:00",
      location: "",
      momentId: "nope",
    });
    expect(ok.isError).toBeFalsy();
    expect(emitted).toEqual([
      {
        t: "action",
        action: { kind: "event", title: "Budget review", start: "2026-11-06T15:00:00+03:00", end: "2026-11-06T16:00:00+03:00", location: null },
        momentId: null,
      },
    ]);
  });

  it("draft_message keeps a subject for email only, and its body within the limit", async () => {
    const { tools, emitted } = setup();
    await call(tools, "draft_message", { channel: "message", to: "Elif", subject: "Slides", body: "Could you send the slides?", momentId: "m1" });
    await call(tools, "draft_message", { channel: "email", to: "Elif", subject: "Slides", body: "Could you send the slides?" });
    expect(emitted.map((e) => (e.t === "action" && e.action.kind === "draft" ? e.action.subject : "?"))).toEqual([null, "Slides"]);
    expect((await call(tools, "draft_message", { channel: "email", body: "x".repeat(2001) })).isError).toBe(true);
    expect(emitted).toHaveLength(2);
  });

  it("cite_moments emits the known ids once, and turns down ids it does not know", async () => {
    const { tools, emitted } = setup();
    expect((await call(tools, "cite_moments", { ids: ["zzz"] })).isError).toBe(true);
    await call(tools, "cite_moments", { ids: ["m2", "zzz", "m2", "m1"] });
    expect(emitted).toEqual([{ t: "cite", momentIds: ["m2", "m1"] }]);
  });
});

describe("withoutPreambles", () => {
  const text = (delta: string): LlmEvent => ({ type: "text", delta });
  const start = (name: string): LlmEvent => ({ type: "tool_start", name });
  const end = (name: string): LlmEvent => ({ type: "tool_end", name, ok: true });
  const done: LlmEvent = { type: "done", stopReason: "end_turn", inputTokens: null, outputTokens: null };
  const filter = async (events: LlmEvent[]) => {
    const out: LlmEvent[] = [];
    for await (const e of withoutPreambles((async function* () { yield* events; })(), 40)) out.push(e);
    return out;
  };
  const said = (events: LlmEvent[]) => events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");

  it("drops the words before a tool call when the model says more after it", async () => {
    const answer = "Elif sends the slides by Thursday, and the review is on Friday.";
    const out = await filter([text("I'll set "), text("that reminder."), start("create_reminder"), text("\n"), end("create_reminder"), text(answer), done]);
    expect(said(out)).toBe(answer);
    expect(out.map((e) => e.type)).toEqual(["tool_start", "tool_end", "text", "done"]);
  });

  it("keeps a short answer given before a citation when nothing follows it", async () => {
    const out = await filter([text("Friday at three."), start("cite_moments"), end("cite_moments"), done]);
    expect(out.map((e) => e.type)).toEqual(["tool_start", "tool_end", "text", "done"]);
    expect(said(out)).toBe("Friday at three.");
  });

  it("streams an answer once it is long enough, spaces and all, and keeps it through later calls", async () => {
    const out = await filter([
      text("The review moved to Friday at three, "),
      text("and Elif sends the slides."),
      text(" "),
      text("Anything else?"),
      start("cite_moments"),
      text("\n"),
      end("cite_moments"),
      done,
    ]);
    expect(said(out)).toBe("The review moved to Friday at three, and Elif sends the slides. Anything else?");
    expect(out.findIndex((e) => e.type === "text")).toBeLessThan(out.findIndex((e) => e.type === "tool_start"));
  });

  it("says a short answer without tools at the end, and nothing held when the model refuses", async () => {
    expect(said(await filter([text("Friday."), done]))).toBe("Friday.");
    expect(said(await filter([text("Sure, "), { type: "refusal" }, done]))).toBe("");
  });

  it("drops the answer said again after a tool call that followed it, and keeps what is new", async () => {
    const answer = "The launch deck is due Friday at three, from Ayşe. I'll remind you to check it then.";
    const out = await filter([
      text(answer),
      start("create_reminder"),
      end("create_reminder"),
      text("\nThe launch deck is due Friday at three, from Ayşe! "),
      text("I'll remind you to check it then. I've proposed the reminder for Friday at three."),
      done,
    ]);
    expect(said(out)).toBe(`${answer} I've proposed the reminder for Friday at three.`);
    // What came after the call waits for the end, so nothing of the repeat ever goes out.
    expect(out.map((e) => e.type)).toEqual(["text", "tool_start", "tool_end", "text", "done"]);
    const again = await filter([text(answer), start("create_reminder"), end("create_reminder"), text(answer), done]);
    expect(said(again)).toBe(answer);
  });
});

describe("newSentences", () => {
  it("keeps sentences that are new and drops repeats, whatever the case and punctuation", () => {
    const spoken = "Elif sends the slides by Thursday. The review is on Friday.";
    expect(newSentences("elif SENDS the slides, by Thursday!  Anything else?", spoken)).toBe("Anything else?");
    expect(newSentences("Friday.\nThe review is on Friday.", spoken)).toBe("");
    expect(newSentences("I proposed a reminder for Thursday.", spoken)).toBe("I proposed a reminder for Thursday.");
    expect(newSentences("Toplantı Cuma günü saat üçte.", "Toplantı Cuma günü saat üçte. Slaytları Can gönderecek.")).toBe("");
    expect(newSentences("", spoken)).toBe("");
  });
});

describe("searchMoments", () => {
  it("ranks a title or person above what was only said, and the newer moment among equals", () => {
    const hits = searchMoments(MOMENTS, "budget");
    expect(hits.map((h) => h.moment.id)).toEqual(["m1"]);
    const either = searchMoments(MOMENTS, "Friday Cuma");
    // Both match in the title or summary once; m1 is newer.
    expect(either.map((h) => h.moment.id)).toEqual(["m1", "m2"]);
    expect(searchMoments(MOMENTS, "Elif")[0]).toMatchObject({ fields: expect.arrayContaining(["people", "transcript"]) });
  });

  it("matches word forms either way round, numbers exactly, and ignores filler words", () => {
    expect(searchMoments(MOMENTS, "meetings")[0]?.moment.id).toBe("m1");
    expect(searchMoments(MOMENTS, "mekan")[0]?.moment.id).toBe("m2");
    expect(searchMoments(MOMENTS, "4200")[0]?.moment.id).toBe("m3");
    expect(searchMoments(MOMENTS, "42")).toEqual([]);
    expect(queryWords("What did they say about the garage?")).toEqual(["they", "garage"]);
    expect(searchMoments(MOMENTS, "   ")).toEqual([]);
  });

  it("cuts a long transcript around the first match", () => {
    const long = `${"filler ".repeat(200)}the garage called ${"more ".repeat(200)}`;
    const cut = excerpt(long, ["garage"]);
    expect(cut).toContain("the garage called");
    expect(cut.startsWith("…")).toBe(true);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(602);
  });
});
