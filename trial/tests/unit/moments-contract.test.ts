import { describe, expect, it } from "vitest";
import {
  AgentActionSchema,
  AgentRequestSchema,
  MomentContentSchema,
  MomentRequestMetaSchema,
  type MomentContent,
} from "@/lib/shared/moments";

const CONTENT: MomentContent = {
  title: "Budget review moved to Friday",
  summary: "Someone moved the budget review to Friday at three. Elif will send the slides.",
  keyPoints: ["Review on Friday at 15:00"],
  actionItems: [{ text: "Send the slides", due: "2026-11-06T15:00:00+03:00" }],
  people: ["Elif"],
  topics: ["budget"],
  language: "en",
};

const META = {
  speechLang: "auto",
  replyLang: "tr",
  now: "2026-11-02T14:05:00+03:00",
  timeZone: "Europe/Istanbul",
  place: "Moda, Kadıköy",
  trigger: "clench",
  speak: true,
};

const AGENT = {
  messages: [{ role: "user", text: "What did Elif promise?" }],
  moments: [
    {
      id: "m1",
      createdAt: "2026-11-02T11:05:00.000Z",
      place: null,
      title: CONTENT.title,
      summary: CONTENT.summary,
      keyPoints: CONTENT.keyPoints,
      actionItems: CONTENT.actionItems,
      people: CONTENT.people,
      transcript: "Let's move the budget review to Friday at three. Elif, can you send the slides?",
    },
  ],
  now: "2026-11-02T14:05:00+03:00",
  timeZone: "Europe/Istanbul",
  replyLang: "en",
  speak: false,
};

describe("moments contract", () => {
  it("takes a well formed moment and trims its text", () => {
    expect(MomentContentSchema.parse(CONTENT)).toEqual(CONTENT);
    expect(MomentContentSchema.parse({ ...CONTENT, title: "  Padded  " }).title).toBe("Padded");
  });

  it("refuses moments past their limits or in another language", () => {
    expect(MomentContentSchema.safeParse({ ...CONTENT, title: "x".repeat(121) }).success).toBe(false);
    expect(MomentContentSchema.safeParse({ ...CONTENT, keyPoints: Array(7).fill("point") }).success).toBe(false);
    expect(MomentContentSchema.safeParse({ ...CONTENT, actionItems: [{ text: "Call", due: undefined }] }).success).toBe(false);
    expect(MomentContentSchema.safeParse({ ...CONTENT, language: "de" }).success).toBe(false);
  });

  it("takes the request meta of a clench, and refuses an unknown trigger or language", () => {
    expect(MomentRequestMetaSchema.parse(META)).toEqual(META);
    expect(MomentRequestMetaSchema.parse({ ...META, place: null, timeZone: null }).place).toBeNull();
    expect(MomentRequestMetaSchema.safeParse({ ...META, trigger: "wink" }).success).toBe(false);
    expect(MomentRequestMetaSchema.safeParse({ ...META, replyLang: "auto" }).success).toBe(false);
    expect(MomentRequestMetaSchema.safeParse({ ...META, speak: "yes" }).success).toBe(false);
  });

  it("takes an agent request, with at most 12 moments and 20 messages", () => {
    expect(AgentRequestSchema.parse(AGENT).moments[0]!.id).toBe("m1");
    expect(AgentRequestSchema.safeParse({ ...AGENT, messages: [] }).success).toBe(false);
    expect(AgentRequestSchema.safeParse({ ...AGENT, messages: Array(21).fill(AGENT.messages[0]) }).success).toBe(false);
    expect(AgentRequestSchema.safeParse({ ...AGENT, moments: Array(13).fill(AGENT.moments[0]) }).success).toBe(false);
    expect(AgentRequestSchema.safeParse({ ...AGENT, moments: [{ ...AGENT.moments[0], transcript: "x".repeat(4001) }] }).success).toBe(false);
  });

  it("tells the three kinds of action apart", () => {
    expect(AgentActionSchema.parse({ kind: "reminder", text: "Send the slides", due: null }).kind).toBe("reminder");
    expect(
      AgentActionSchema.parse({ kind: "event", title: "Budget review", start: "2026-11-06T15:00:00+03:00", end: null, location: null }).kind,
    ).toBe("event");
    expect(
      AgentActionSchema.parse({ kind: "draft", channel: "email", to: "Elif", subject: "Slides", body: "Could you send the slides?" }).kind,
    ).toBe("draft");
    expect(AgentActionSchema.safeParse({ kind: "draft", channel: "fax", to: null, subject: null, body: "Hi" }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ kind: "alarm", text: "Wake up", due: null }).success).toBe(false);
  });
});
