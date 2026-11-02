import { z } from "zod";

/**
 * Moments: what a clench keeps. The earbuds' wearer clenches, the last
 * seconds the microphone heard go to POST /api/moments once, and what comes
 * back is written down on the device: when, where, what was said, what it
 * means, what to do about it. Nothing about a moment is stored on the server;
 * the moments live in the browser (IndexedDB) and travel to POST /api/agent
 * only as the few the device picked as context for one question.
 *
 * This file is the contract between the server routes and the app: the
 * request bodies (zod, validated on the server), the moment and action shapes
 * (validated wherever they cross a boundary), and the NDJSON events both
 * routes stream. The events extend the assistant's stream (transcript, text,
 * sentence, audio as base64 PCM per sentence, done, error, no_speech), so the
 * app plays a moment's spoken confirmation and an agent's reply with the
 * player it already has.
 */

const text = (max: number) => z.string().trim().max(max);

/** What the language model writes about the seconds a clench kept. */
export const MomentContentSchema = z.object({
  /** A few words, like the subject of an email. */
  title: text(120),
  /** Two or three sentences in the reply language. */
  summary: text(800),
  keyPoints: z.array(text(240)).max(6),
  /** Things someone said they or the wearer would do; due is ISO 8601 when a time was said, else null. */
  actionItems: z.array(z.object({ text: text(240), due: text(40).nullable() })).max(6),
  people: z.array(text(60)).max(8),
  topics: z.array(text(40)).max(6),
  language: z.enum(["en", "tr"]),
});
export type MomentContent = z.infer<typeof MomentContentSchema>;

export type MomentTrigger = "clench" | "button" | "key";

export interface MomentPlace {
  /** A short name for where the wearer was, such as a street and district; resolved on the device. */
  name: string;
  lat: number;
  lon: number;
}

/** Something the agent proposes; nothing happens until the wearer accepts it on the device. */
export const AgentActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reminder"), text: text(240), due: text(40).nullable() }),
  z.object({
    kind: z.literal("event"),
    title: text(120),
    /** ISO 8601 with offset. */
    start: text(40),
    end: text(40).nullable(),
    location: text(160).nullable(),
  }),
  z.object({
    kind: z.literal("draft"),
    channel: z.enum(["message", "email"]),
    to: text(120).nullable(),
    subject: text(160).nullable(),
    body: text(2000),
  }),
]);
export type AgentActionProposal = z.infer<typeof AgentActionSchema>;

export type AgentAction = AgentActionProposal & {
  id: string;
  /** The moment it came from, when it came from one. */
  momentId: string | null;
  createdAt: string;
  status: "proposed" | "accepted" | "dismissed";
};

/** A moment as the device keeps it. */
export interface Moment extends MomentContent {
  id: string;
  createdAt: string;
  timeZone: string | null;
  place: MomentPlace | null;
  trigger: MomentTrigger;
  /** Seconds of audio it was made from. */
  seconds: number;
  /** What was said, as recognized; kept on the device only. */
  transcript: string;
  actions: AgentAction[];
  pinned: boolean;
}

/**
 * POST /api/moments: multipart form with "audio" (16 kHz mono WAV, at most
 * REWIND_BUFFER_SEC seconds) and "meta" (this, as JSON).
 */
export const MomentRequestMetaSchema = z.object({
  speechLang: z.enum(["en", "tr", "auto"]),
  replyLang: z.enum(["en", "tr"]),
  now: text(80),
  timeZone: text(60).nullable(),
  /** Where the wearer was, already resolved to a name on the device, or null. */
  place: text(160).nullable(),
  trigger: z.enum(["clench", "button", "key"]),
  /** Stream a short spoken confirmation ("Saved: ...") after the moment. */
  speak: z.boolean(),
});
export type MomentRequestMeta = z.infer<typeof MomentRequestMetaSchema>;

/** One moment the device chose as context for a question. */
export const AgentMomentContextSchema = z.object({
  id: text(64),
  createdAt: text(40),
  place: text(160).nullable(),
  title: text(120),
  summary: text(800),
  keyPoints: z.array(text(240)).max(6),
  actionItems: z.array(z.object({ text: text(240), due: text(40).nullable() })).max(6),
  people: z.array(text(60)).max(8),
  /** Trimmed by the device to what fits. */
  transcript: text(4000),
});
export type AgentMomentContext = z.infer<typeof AgentMomentContextSchema>;

/** POST /api/agent: JSON. */
export const AgentRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: text(4000) }))
    .min(1)
    .max(20),
  moments: z.array(AgentMomentContextSchema).max(12),
  now: text(80),
  timeZone: text(60).nullable(),
  replyLang: z.enum(["en", "tr"]),
  /** Stream the reply as speech too. */
  speak: z.boolean(),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

/** The assistant's stream events both routes share (see lib/server/assistant-pipeline.ts). */
export type BaseStreamEvent =
  | { t: "transcript"; text: string; language: "en" | "tr" | null; provider: string; model: string; ms: number }
  | { t: "no_speech" }
  | { t: "tool"; name: string; state: "start" | "end" }
  | { t: "text"; delta: string }
  | { t: "sentence"; i: number; text: string }
  | { t: "audio"; i: number; sr: number; pcm: string }
  | { t: "error"; code: string };

/** POST /api/moments streams: transcript, then the moment, then the spoken confirmation, then done. */
export type MomentStreamEvent =
  | BaseStreamEvent
  | { t: "moment"; content: MomentContent; model: string }
  | { t: "done"; totalMs: number };

/** POST /api/agent streams: tool use, the reply as text (and speech), the actions it proposes, the moments it drew on. */
export type AgentStreamEvent =
  | BaseStreamEvent
  | { t: "action"; action: AgentActionProposal; momentId: string | null }
  | { t: "cite"; momentIds: string[] }
  | { t: "done"; reply: string; model: string; totalMs: number };
