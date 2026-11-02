import "server-only";
import { z } from "zod";
import {
  AgentActionSchema,
  type AgentActionProposal,
  type AgentRequest,
  type AgentStreamEvent,
} from "@/lib/shared/moments";
import { hedgeStream, retryableProviderError as retryable } from "@/lib/server/hedge";
import { describeTime, localClock, normalizeIsoTime } from "@/lib/server/local-time";
import { searchMoments } from "@/lib/server/moments-search";
import { agentMomentsBlock, agentSystemPrompt } from "@/lib/server/prompts";
import type { AgentTool, AgentToolResult, ChatTurn, LlmEvent, LlmProvider, TtsProvider } from "@/lib/server/providers/types";
import { LLM_HEDGE_MS, logHedge, SpokenReply } from "@/lib/server/spoken-reply";

/**
 * The agent: one question from the wearer about their moments, answered by
 * the language model with tools over the few moments the device sent along
 * (the server keeps none). It can search them, propose a reminder, an event
 * or a draft, which the wearer accepts or dismisses on the device (nothing
 * is done here), and name the moments it drew on. The reply streams as text,
 * and as speech when asked; the actions and citations arrive as their own
 * events while it does.
 */

type SideEvent = Extract<AgentStreamEvent, { t: "action" } | { t: "cite" }>;

export interface AgentDeps {
  llm: LlmProvider;
  tts: TtsProvider;
}

/** Search, then act, then answer: three rounds of tool calls cover a question. */
const MAX_TOOL_ROUNDS = 3;
/** Room for a drafted email in a tool call, plus the reply. */
const MAX_TOKENS = 1500;

export async function* runAgent(req: AgentRequest, deps: AgentDeps, signal: AbortSignal): AsyncGenerator<AgentStreamEvent> {
  const t0 = performance.now();
  const since = () => performance.now() - t0;
  const llm = deps.llm;
  const streamAgentReply = llm.streamAgentReply?.bind(llm);
  if (!streamAgentReply) {
    yield { t: "error", code: "agent_unavailable" };
    return;
  }

  // The question is the last turn, the wearer's; the history before it must
  // start with the wearer too.
  const turns: ChatTurn[] = req.messages.map((m) => ({ role: m.role, text: m.text.trim() })).filter((m) => m.text);
  while (turns[0]?.role === "assistant") turns.shift();
  const question = turns.pop();
  if (!question || question.role !== "user") {
    yield { t: "error", code: "invalid_request" };
    return;
  }

  const reply = new SpokenReply<SideEvent>({
    tts: req.speak ? deps.tts : null,
    lang: req.replyLang,
    userLang: req.replyLang,
    whisper: false,
    signal,
    since,
    metric: "agent",
  });
  const tools = agentTools(req, (e) => reply.push(e));
  const system = agentSystemPrompt({
    lang: req.replyLang,
    speak: req.speak,
    clock: localClock(req.now, req.timeZone),
    moments: agentMomentsBlock(req.moments, req.timeZone),
  });
  const result = yield* reply.run((s) =>
    withoutPreambles(
      hedgeStream(
        (h) =>
          streamAgentReply({
            system,
            history: turns,
            user: question.text,
            tools,
            maxToolRounds: MAX_TOOL_ROUNDS,
            maxTokens: MAX_TOKENS,
            answeredChars: PREAMBLE_CHARS,
            signal: h,
          }),
        // Hedged like the assistant. A second attempt only ever starts while
        // none has produced anything, and tools run after an attempt's first
        // event, so they run in the attempt that is kept and nowhere else.
        { afterMs: LLM_HEDGE_MS, signal: s, retryable, onHedge: (cause) => logHedge("agent", "llm", llm.id, cause) },
      ),
    ),
  );
  if (!result.ok) return;
  yield { t: "done", reply: result.reply, model: result.model ?? llm.model, totalMs: result.endMs };
}

/** How much text a stretch must reach before it is taken for the answer. */
const PREAMBLE_CHARS = 120;

/**
 * At its lowest thinking setting the model says a few words before a tool
 * call ("I'll propose that reminder and cite the moments."), and the prompt
 * alone does not stop it (measured 2026-11-02); a reply should not carry
 * them. So the text that starts each stretch (the turn's start, and after
 * each tool call) is held until it is long enough to be the answer, when it
 * goes out, or until a tool call starts, when it is set aside. What was set
 * aside is dropped once the model says more after the tools, and said at the
 * end if it does not, since then it was the answer.
 *
 * Once an answer has gone out, a tool call after it (proposing the reminder
 * the answer mentioned) can make the model say the whole answer again
 * (measured 2026-11-02). So what it says after such a call is held to the
 * end, and only its sentences that are new go out.
 */
export async function* withoutPreambles(source: AsyncIterable<LlmEvent>, holdChars = PREAMBLE_CHARS): AsyncGenerator<LlmEvent> {
  let held = "";
  let holding = true;
  let aside = "";
  let said = false;
  // Everything that went out, whether a tool call came after some of it, and what followed that call.
  let spoken = "";
  let after = false;
  let post = "";
  // The reply starts with its first word, not the newline between rounds.
  const release = (text: string): LlmEvent[] => {
    const delta = said ? text : text.trimStart();
    if (!delta) return [];
    said = true;
    spoken += delta;
    return [{ type: "text", delta }];
  };
  const flush = (): LlmEvent[] => {
    const fresh = newSentences(post, spoken);
    post = "";
    return fresh ? release(`${/\s$/.test(spoken) ? "" : " "}${fresh}`) : [];
  };
  for await (const ev of source) {
    if (ev.type === "text") {
      if (after) {
        post += ev.delta;
        continue;
      }
      if (!holding) {
        yield* release(ev.delta);
        continue;
      }
      held += ev.delta;
      if (!held.trim()) continue;
      aside = "";
      if (held.trim().length >= holdChars) {
        yield* release(held);
        held = "";
        holding = false;
      }
      continue;
    }
    if (ev.type === "tool_start") {
      if (said) after = true;
      if (held.trim()) aside = held;
      held = "";
      holding = true;
    } else if (ev.type === "refusal") {
      held = aside = post = "";
    } else if (ev.type === "done") {
      yield* after ? flush() : release(held.trim() ? held : aside);
      held = aside = "";
    }
    yield ev;
  }
  yield* after ? flush() : release(held.trim() ? held : aside);
}

/**
 * The sentences of text that are not a repeat of spoken: a sentence repeats
 * when most of its runs of three words were already said (a short one, when
 * all of it was), whatever the case and punctuation.
 */
export function newSentences(text: string, spoken: string): string {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
  const said = words(spoken);
  const triples = new Set<string>();
  for (let i = 0; i + 2 < said.length; i++) triples.add(`${said[i]} ${said[i + 1]} ${said[i + 2]}`);
  const whole = ` ${said.join(" ")} `;
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => {
      const w = words(s);
      if (!w.length) return false;
      if (w.length < 3) return !whole.includes(` ${w.join(" ")} `);
      let seen = 0;
      for (let i = 0; i + 2 < w.length; i++) if (triples.has(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)) seen++;
      return seen / (w.length - 2) < 0.5;
    })
    .join(" ");
}

const momentId = z
  .string()
  .max(64)
  .nullable()
  .optional()
  .describe("The id of the moment this comes from, or null when it comes from none");
const isoTime = (what: string) =>
  z.string().max(40).describe(`${what}, as ISO 8601 with the UTC offset, for example 2026-11-06T15:00:00+03:00`);

const FindInput = z.object({
  query: z.string().trim().min(1).max(200).describe("A few keywords, in the language the moments were likely said or written in"),
});
const ReminderInput = z.object({
  text: z.string().trim().min(1).max(240).describe("What to remind the wearer of, as a short note to themselves in the reply language, such as \"Check the launch deck\""),
  due: isoTime("When").nullable().optional().describe("When, as ISO 8601 with the UTC offset, or a date alone; null when no time was given"),
  momentId,
});
const EventInput = z.object({
  title: z.string().trim().min(1).max(120),
  start: isoTime("When it starts"),
  end: isoTime("When it ends").nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  momentId,
});
const DraftInput = z.object({
  channel: z.enum(["message", "email"]),
  to: z.string().trim().max(120).nullable().optional().describe("Who it is for, as the wearer or the moment names them"),
  subject: z.string().trim().max(160).nullable().optional().describe("Email only"),
  body: z.string().trim().min(1).max(2000).describe("The text, ready to send, in the language the wearer wants"),
  momentId,
});
const CiteInput = z.object({ ids: z.array(z.string().max(64)).min(1).max(12) });

const PROPOSED =
  "Proposed to the wearer, who confirms it in the app; nothing happens until they do. Tell them it is proposed, not done.";

/**
 * The agent's tools over one request's moments. emit puts an action or a
 * citation into the reply's stream at the moment the model makes it.
 */
export function agentTools(req: Pick<AgentRequest, "moments" | "timeZone">, emit: (e: SideEvent) => void): AgentTool[] {
  const ids = new Set(req.moments.map((m) => m.id));
  const known = (id: string | null | undefined) => (id && ids.has(id) ? id : null);
  const fail = (content: string): AgentToolResult => ({ content, isError: true });
  const tool = <S extends z.ZodType>(
    name: string,
    description: string,
    input: S,
    run: (input: z.infer<S>) => AgentToolResult,
    opts: { endsTurn?: boolean; endsTurnAfterAnswer?: boolean } = {},
  ): AgentTool => ({ name, description, input, ...opts, run: async (i) => run(i as z.infer<S>) });

  const propose = (action: AgentActionProposal, from: string | null | undefined): AgentToolResult => {
    const parsed = AgentActionSchema.safeParse(action);
    if (!parsed.success) return fail(`Not proposed: ${parsed.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ")}`);
    emit({ t: "action", action: parsed.data, momentId: known(from) });
    return { content: PROPOSED };
  };

  return [
    tool(
      "find_moments",
      "Search the wearer's moments by keywords, including the full transcript of what was said in each. Call it when the answer needs exact words, numbers, names or details the moment summaries do not show, or to find which moments mention something. Returns the best matches with their ids and, when the words were said, an excerpt.",
      FindInput,
      ({ query }) => {
        const hits = searchMoments(req.moments, query);
        return {
          content: JSON.stringify({
            matches: hits.map((h) => ({
              id: h.moment.id,
              kept: describeTime(h.moment.createdAt, req.timeZone),
              place: h.moment.place,
              title: h.moment.title,
              matched: h.fields,
              ...(h.excerpt ? { said: h.excerpt } : {}),
            })),
            ...(hits.length ? {} : { note: "No moment matches these words." }),
          }),
        };
      },
    ),
    tool(
      "create_reminder",
      "Propose a reminder to the wearer. Call it when they ask to be reminded of something, from a moment or not. The wearer confirms it in the app; nothing is set until then.",
      ReminderInput,
      ({ text, due, momentId: from }) => {
        const when = due ? normalizeIsoTime(due, req.timeZone) : null;
        if (due && !when) return fail("due must be ISO 8601, a date and time with the UTC offset (2026-11-06T15:00:00+03:00) or a date (2026-11-06).");
        return propose({ kind: "reminder", text, due: when }, from);
      },
      // The answer usually announces it first; then the turn is over.
      { endsTurnAfterAnswer: true },
    ),
    tool(
      "create_event",
      "Propose a calendar event to the wearer. Call it when they ask to put something in their calendar or to schedule it. start needs a date and a time: when nobody gave a time, ask the wearer instead of calling this. The wearer confirms it in the app.",
      EventInput,
      ({ title, start, end, location, momentId: from }) => {
        const begins = normalizeIsoTime(start, req.timeZone);
        if (!begins || !begins.includes("T")) return fail("start must be a date and time in ISO 8601 with the UTC offset, for example 2026-11-06T15:00:00+03:00. If no time was said, ask the wearer.");
        const ends = end ? normalizeIsoTime(end, req.timeZone) : null;
        if (end && (!ends || !ends.includes("T") || Date.parse(ends) <= Date.parse(begins))) {
          return fail("end must be a date and time in ISO 8601 with the UTC offset, after start, or null.");
        }
        return propose({ kind: "event", title, start: begins, end: ends, location: location || null }, from);
      },
      // The answer usually announces it first; then the turn is over.
      { endsTurnAfterAnswer: true },
    ),
    tool(
      "draft_message",
      "Propose a message or an email for the wearer to review and send themselves. Call it when they ask you to write, draft, answer or follow up with someone. The wearer confirms it in the app; you send nothing.",
      DraftInput,
      ({ channel, to, subject, body, momentId: from }) =>
        propose({ kind: "draft", channel, to: to || null, subject: channel === "email" ? subject || null : null, body }, from),
      // The answer usually announces it first; then the turn is over.
      { endsTurnAfterAnswer: true },
    ),
    tool(
      "cite_moments",
      "Record the moments your answer draws on; the app lists them under the reply. Call it, before you write the reply, whenever the answer uses the wearer's moments, with their ids. Never mention it in the reply.",
      CiteInput,
      ({ ids: cited }) => {
        const momentIds = [...new Set(cited.filter((id) => ids.has(id)))];
        if (!momentIds.length) return fail("None of these ids is one of the wearer's moments.");
        emit({ t: "cite", momentIds });
        return { content: `Cited ${momentIds.length}.` };
      },
      // Called after an answer it only records where the answer came from.
      { endsTurn: true },
    ),
  ];
}
