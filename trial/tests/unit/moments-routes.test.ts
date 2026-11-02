import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as agent } from "@/app/api/agent/route";
import { POST as moments } from "@/app/api/moments/route";
import { POST as speak } from "@/app/api/speak/route";
import { POST as stt } from "@/app/api/stt/route";
import { MockLlm, MockStt, MockTts } from "@/lib/server/providers/mock";
import type { LlmProvider, SttProvider } from "@/lib/server/providers/types";
import { rateLimit } from "@/lib/server/rate-limit";
import { getStore } from "@/lib/server/store";
import { encodeWav } from "@/lib/shared/audio/wav";
import { CONSENT_VERSION } from "@/lib/shared/constants";

// Route handlers outside Next.js: after() callbacks are held until the test
// has read the response, the providers are the mocks (or a test's own), and
// every call to the logger is recorded before it runs.
const held = vi.hoisted(() => ({ after: [] as (() => unknown)[] }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void held.after.push(fn) }));

const providers = vi.hoisted(() => ({ stt: null as unknown, llm: null as unknown, tts: null as unknown }));
vi.mock("@/lib/server/providers", () => ({
  getStt: () => providers.stt,
  getLlm: () => providers.llm,
  getTts: () => providers.tts,
}));

const logged = vi.hoisted(() => ({ calls: [] as { fn: string; event: string; fields: unknown }[] }));
vi.mock("@/lib/server/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/log")>();
  return {
    logMetric: (event: string, fields: Parameters<typeof real.logMetric>[1] = {}) => {
      logged.calls.push({ fn: "logMetric", event, fields });
      real.logMetric(event, fields);
    },
    logError: (event: string, err: unknown, fields: Parameters<typeof real.logError>[2] = {}) => {
      logged.calls.push({ fn: "logError", event, fields });
      real.logError(event, err, fields);
    },
  };
});

/** A signed in user of the in-memory store, with or without the trial's terms accepted. */
async function user(consented = true) {
  const id = randomUUID();
  const token = `dev.${id}`;
  if (consented) await getStore().forUser({ userId: id, accessToken: token, isAnonymous: true }).recordConsent("terms", CONSENT_VERSION, true);
  return { id, auth: { authorization: `Bearer ${token}` } };
}

const tone = (seconds = 2) => {
  const x = new Float32Array(16000 * seconds);
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 16000);
  return encodeWav(x, 16000);
};

const META = {
  speechLang: "en",
  replyLang: "en",
  now: "2026-11-02T14:05:00+03:00",
  timeZone: "Europe/Istanbul",
  place: "Moda, Kadıköy",
  trigger: "clench",
  speak: true,
};

function momentRequest(headers: Record<string, string>, meta: unknown = META, audio: Uint8Array = tone()) {
  const form = new FormData();
  form.append("meta", typeof meta === "string" ? meta : JSON.stringify(meta));
  form.append("audio", new Blob([audio as BlobPart], { type: "audio/wav" }), "moment.wav");
  return new Request("http://localhost/api/moments", { method: "POST", headers, body: form });
}

const json = (path: string, headers: Record<string, string>, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });

const AGENT = {
  messages: [{ role: "user", text: "What did Elif ask for?" }],
  moments: [
    {
      id: "m1",
      createdAt: "2026-11-02T11:05:00.000Z",
      place: null,
      title: "Budget review moved to Friday",
      summary: "The review moved to Friday. Elif will send the slides.",
      keyPoints: [],
      actionItems: [{ text: "Send the slides", due: null }],
      people: ["Elif"],
      transcript: "Elif, can you send the slides?",
    },
  ],
  now: "2026-11-02T14:05:00+03:00",
  timeZone: "Europe/Istanbul",
  replyLang: "en",
  speak: false,
};

/** The response's events, after which the held after() callbacks run. */
async function events(res: Response) {
  const out = (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { t: string } & Record<string, unknown>);
  for (const fn of held.after.splice(0)) await fn();
  return out;
}

beforeEach(() => {
  providers.stt = new MockStt();
  providers.llm = new MockLlm();
  providers.tts = new MockTts();
  logged.calls.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("guards", () => {
  it("turn away a request without a user", async () => {
    for (const res of [
      await moments(momentRequest({})),
      await agent(json("/api/agent", {}, AGENT)),
      await speak(json("/api/speak", {}, { text: "Hello.", lang: "en" })),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
    }
  });

  it("turn away a user who has not accepted the trial's terms", async () => {
    const { auth } = await user(false);
    for (const res of [
      await moments(momentRequest(auth)),
      await agent(json("/api/agent", auth, AGENT)),
      await speak(json("/api/speak", auth, { text: "Hello.", lang: "en" })),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "consent_required" });
    }
  });

  it("limit each user's requests per minute, per route", async () => {
    const { id, auth } = await user();
    for (let i = 0; i < 20; i++) rateLimit(id, "moments");
    const limited = await moments(momentRequest(auth));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    // Other routes keep their own count.
    const spoken = await speak(json("/api/speak", auth, { text: "Hello.", lang: "en" }));
    expect(spoken.status).toBe(200);
    await events(spoken);
    for (let i = 0; i < 20; i++) rateLimit(id, "agent");
    expect((await agent(json("/api/agent", auth, AGENT))).status).toBe(429);
    const other = await user();
    for (let i = 0; i < 30; i++) rateLimit(other.id, "speak");
    expect((await speak(json("/api/speak", other.auth, { text: "Hello.", lang: "en" }))).status).toBe(429);
  });

  it("refuse malformed requests with a code", async () => {
    const { auth } = await user();
    const cases: [Promise<Response>, number, string][] = [
      [moments(json("/api/moments", auth, META)), 400, "audio_required"],
      [moments(momentRequest(auth, "{not json")), 400, "invalid_request"],
      [moments(momentRequest(auth, { ...META, trigger: "wink" })), 400, "invalid_request"],
      [moments(momentRequest(auth, META, new TextEncoder().encode("not a wav file, but long enough to pass the size check"))), 400, "audio_invalid"],
      [moments(momentRequest(auth, META, tone(31))), 413, "audio_too_large"],
      [agent(json("/api/agent", auth, { ...AGENT, messages: [...AGENT.messages, { role: "assistant", text: "Hi." }] })), 400, "invalid_request"],
      [agent(json("/api/agent", auth, { ...AGENT, moments: "all" })), 400, "invalid_request"],
      [speak(json("/api/speak", auth, { text: "  ", lang: "en" })), 400, "invalid_request"],
      [speak(json("/api/speak", auth, { text: "Hello.", lang: "de" })), 400, "invalid_request"],
    ];
    for (const [res, status, error] of cases) {
      const r = await res;
      expect([r.status, await r.json()]).toEqual([status, { error }]);
    }
  });
});

describe("routes", () => {
  it("POST /api/moments streams the transcript, the moment, the spoken confirmation and done", async () => {
    const { auth } = await user();
    const res = await moments(momentRequest(auth));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const out = await events(res);
    expect(out.slice(0, 2).map((e) => e.t)).toEqual(["transcript", "moment"]);
    expect(out[1]).toMatchObject({ t: "moment", model: "mock-llm", content: { language: "en" } });
    expect(out.some((e) => e.t === "sentence") && out.some((e) => e.t === "audio")).toBe(true);
    expect(out.at(-1)!.t).toBe("done");
  });

  it("POST /api/agent streams the tools, a proposed action, a citation, the reply and done", async () => {
    const { auth } = await user();
    const out = await events(await agent(json("/api/agent", auth, AGENT)));
    expect(out.filter((e) => e.t === "action")).toEqual([
      { t: "action", action: { kind: "reminder", text: "Follow up: Budget review moved to Friday", due: null }, momentId: "m1" },
    ]);
    expect(out.filter((e) => e.t === "cite")).toEqual([{ t: "cite", momentIds: ["m1"] }]);
    expect(out.at(-1)).toMatchObject({ t: "done", model: "mock-llm" });
  });

  it("POST /api/speak streams sentences and audio, then done, and no text", async () => {
    const { auth } = await user();
    const out = await events(await speak(json("/api/speak", auth, { text: "Budget review. It moved to Friday.", lang: "en" })));
    expect(out.filter((e) => e.t === "sentence").map((e) => e.text)).toEqual(["Budget review.", "It moved to Friday."]);
    expect(out.some((e) => e.t === "audio")).toBe(true);
    expect(out.some((e) => e.t === "text")).toBe(false);
    expect(out.at(-1)!.t).toBe("done");
  });
});

describe("privacy", () => {
  // Words that appear in the speech, the moment, the question, the moments
  // sent as context, the reply and the text read aloud, and nowhere else.
  const SECRET = ["zebracorn", "quillon", "marzipan"];
  const SAID = "Zebracorn budget meeting with Quillon on Friday. Quillon, you need to send the marzipan slides.";

  const saying: SttProvider = {
    id: "mock",
    model: "said",
    capabilities: { streaming: false, browserStreaming: false, streamingLanguages: [], autoDetect: true },
    async transcribeFile() {
      return { text: SAID, language: "en", confidence: null, provider: "mock", model: "said", latencyMs: 3 };
    },
    async *transcribeStream() {},
  };

  it("logs metrics only: no transcript, moment, question, reply or spoken text reaches a log", async () => {
    const printed: string[] = [];
    for (const method of ["log", "error", "warn", "info", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(" ")));
    }
    providers.stt = saying;
    const { auth } = await user();

    const moment = await events(await moments(momentRequest(auth)));
    const content = moment.find((e) => e.t === "moment")!.content as { title: string };
    expect(content.title.toLowerCase()).toContain("zebracorn");

    const question = {
      ...AGENT,
      speak: true,
      messages: [{ role: "user", text: "What did Quillon say about the zebracorn slides?" }],
      moments: [{ ...AGENT.moments[0]!, title: content.title, transcript: SAID, people: ["Quillon"] }],
    };
    const answer = await events(await agent(json("/api/agent", auth, question)));
    expect(String(answer.at(-1)!.reply).toLowerCase()).toContain("zebracorn");
    await events(await speak(json("/api/speak", auth, { text: "Marzipan slides for Quillon.", lang: "en" })));

    // A failure whose error carries content, as some provider errors do.
    providers.llm = {
      ...new MockLlm(),
      id: "mock",
      model: "leaky",
      streamAssistantReply: new MockLlm().streamAssistantReply,
      async extractStructured() {
        throw new Error(`upstream echoed: ${SAID}`);
      },
    } satisfies LlmProvider;
    const failed = await events(await moments(momentRequest(auth)));
    expect(failed.at(-1)).toEqual({ t: "error", code: "server_error" });

    const events_ = logged.calls.map((c) => c.event);
    expect(events_).toEqual(expect.arrayContaining(["moments.made", "agent.turn", "speak.done", "moments.failed"]));
    const made = logged.calls.find((c) => c.event === "moments.made")!.fields as Record<string, unknown>;
    expect(made).toMatchObject({ trigger: "clench", speak: true, empty: false, actionItems: 1 });
    for (const line of [...logged.calls.map((c) => JSON.stringify(c)), ...printed]) {
      for (const word of SECRET) expect(line.toLowerCase()).not.toContain(word);
    }
    expect(printed.length).toBeGreaterThanOrEqual(logged.calls.length);
  });
});

describe("POST /api/stt", () => {
  const clip = (headers: Record<string, string>, meta: unknown = { speechLang: "en" }, audio: Uint8Array = tone()) => {
    const form = new FormData();
    form.append("meta", JSON.stringify(meta));
    form.append("audio", new Blob([audio as BlobPart], { type: "audio/wav" }), "question.wav");
    return new Request("http://localhost/api/stt", { method: "POST", headers, body: form });
  };
  const SAID = "Quillon promised the zebracorn deck";
  const recognizer = (text: string): SttProvider =>
    Object.assign(new MockStt(), {
      async transcribeFile() {
        return { text: ` ${text} `, language: "en" as const, confidence: 0.9, provider: "mock" as const, model: "mock-stt", latencyMs: 12 };
      },
    });

  it("answers with the words of a short clip, and logs nothing of them", async () => {
    const { auth } = await user();
    providers.stt = recognizer(SAID);
    const res = await stt(clip(auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: SAID, language: "en", provider: "mock", model: "mock-stt", ms: 12 });
    for (const fn of held.after.splice(0)) await fn();
    const line = logged.calls.find((c) => c.event === "stt.clip")!;
    expect(line.fields).toMatchObject({ speechLang: "en", empty: false, error: null });
    expect(JSON.stringify(logged.calls).toLowerCase()).not.toContain("zebracorn");
  });

  it("is guarded like the others, and turns away what is not a short clip", async () => {
    expect((await stt(clip({}))).status).toBe(401);
    expect((await stt(clip((await user(false)).auth))).status).toBe(403);
    const { id, auth } = await user();
    const cases: [Request, number, string][] = [
      [clip(auth, { speechLang: "de" }), 400, "invalid_request"],
      [clip(auth, { speechLang: "en" }, tone(31)), 413, "audio_too_large"],
      [json("/api/stt", auth, { speechLang: "en" }), 400, "audio_required"],
    ];
    for (const [req, status, error] of cases) {
      const r = await stt(req);
      expect([r.status, await r.json()]).toEqual([status, { error }]);
    }
    // Those three counted: 57 more fill the minute.
    for (let i = 0; i < 57; i++) rateLimit(id, "stt");
    expect((await stt(clip(auth))).status).toBe(429);
  });

  it("reports a recognizer that fails by its code", async () => {
    const { auth } = await user();
    providers.stt = Object.assign(new MockStt(), {
      async transcribeFile(): Promise<never> {
        throw new Error(`echo: ${SAID}`);
      },
    });
    const r = await stt(clip(auth));
    expect([r.status, await r.json()]).toEqual([502, { error: "server_error" }]);
    for (const fn of held.after.splice(0)) await fn();
    expect(JSON.stringify(logged.calls).toLowerCase()).not.toContain("zebracorn");
  });
});
