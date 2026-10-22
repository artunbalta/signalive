import { describe, expect, it } from "vitest";
import { runAssistant, type AssistantEvent } from "@/lib/server/assistant-pipeline";
import { MockLlm, MockStt, MockTts } from "@/lib/server/providers/mock";
import { ProviderError, type AssistantReplyParams, type LlmProvider, type TtsProvider } from "@/lib/server/providers/types";
import { encodeWav } from "@/lib/shared/audio/wav";

const base = {
  speechLang: "en" as const,
  whisper: false,
  history: [],
  now: "2026-10-21 10:00",
  timeZone: "Europe/Istanbul",
};

function deps(over: Partial<{ tts: TtsProvider; llm: LlmProvider }> = {}) {
  return {
    stt: new MockStt(),
    llm: over.llm ?? new MockLlm(),
    tts: over.tts ?? new MockTts(),
    searchNotes: async () => "[1] Budget review (2026-10-20 09:00 UTC)\nMove the review to Friday.",
  };
}

async function collect(gen: AsyncIterable<AssistantEvent>) {
  const out: AssistantEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const FIVE = ["One is here.", "Two is here.", "Three is here.", "Four is here.", "Five is here."];

/** Replies with five short sentences at once. */
const chatty: LlmProvider = {
  id: "mock",
  model: "chatty",
  async *streamAssistantReply() {
    for (const s of FIVE) yield { type: "text", delta: `${s} ` };
  },
  async extractStructured() {
    return null;
  },
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const speech = () => {
  const x = new Float32Array(16000);
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 16000);
  return { data: encodeWav(x, 16000), mimeType: "audio/wav", durationMs: 1000 };
};

describe("runAssistant", () => {
  it("streams text, sentences and audio in order, then done", async () => {
    const events = await collect(runAssistant({ ...base, transcript: "What can you do?" }, deps(), new AbortController().signal));
    const types = events.map((e) => e.t);
    expect(types[0]).toBe("text");
    expect(types.at(-1)).toBe("done");
    expect(types).toContain("sentence");
    const audio = events.filter((e): e is Extract<AssistantEvent, { t: "audio" }> => e.t === "audio");
    expect(audio.length).toBeGreaterThan(0);
    // Audio arrives sentence by sentence, never out of order.
    for (let i = 1; i < audio.length; i++) expect(audio[i]!.i).toBeGreaterThanOrEqual(audio[i - 1]!.i);
    for (const a of audio) expect(Buffer.from(a.pcm, "base64").length % 2).toBe(0);
    const done = events.at(-1) as Extract<AssistantEvent, { t: "done" }>;
    expect(done.reply).toContain("I heard: What can you do.");
    expect(done.server.llmFirstTokenMs).not.toBeNull();
    expect(done.server.ttsFirstAudioMs!).toBeGreaterThanOrEqual(done.server.firstSentenceMs!);
  });

  it("transcribes audio first when no transcript is given", async () => {
    const events = await collect(runAssistant({ ...base, audio: speech() }, deps(), new AbortController().signal));
    expect(events[0]).toMatchObject({ t: "transcript", provider: "mock" });
    expect(events.at(-1)!.t).toBe("done");
  });

  it("reports silence as no speech without calling the LLM", async () => {
    const silent = { data: encodeWav(new Float32Array(16000), 16000), mimeType: "audio/wav", durationMs: 1000 };
    const events = await collect(runAssistant({ ...base, audio: silent }, deps(), new AbortController().signal));
    expect(events.map((e) => e.t)).toEqual(["transcript", "no_speech"]);
  });

  it("uses the notes tool when asked about notes", async () => {
    const events = await collect(
      runAssistant({ ...base, transcript: "What did I say in my notes about the budget?" }, deps(), new AbortController().signal),
    );
    expect(events.filter((e) => e.t === "tool").map((e) => (e as { state: string }).state)).toEqual(["start", "end"]);
    expect((events.at(-1) as { reply: string }).reply).toContain("1 matching notes");
  });

  it("replies in Turkish to Turkish", async () => {
    const events = await collect(
      runAssistant({ ...base, speechLang: "auto", transcript: "Yarın hava nasıl olacak?" }, deps(), new AbortController().signal),
    );
    expect(events.at(-1)).toMatchObject({ t: "done", language: "tr" });
  });

  it("turns a TTS failure into an error event", async () => {
    const failing: TtsProvider = {
      id: "mock",
      model: "broken",
      sampleRate: 24000,
      // eslint-disable-next-line require-yield
      async *synthesize() {
        throw new ProviderError("mock", "rate_limited", 429);
      },
    };
    const events = await collect(runAssistant({ ...base, transcript: "Hello there." }, deps({ tts: failing }), new AbortController().signal));
    expect(events.at(-1)).toEqual({ t: "error", code: "provider_rate_limited" });
    expect(events.some((e) => e.t === "done")).toBe(false);
  });

  it("synthesizes at most two sentences at once, in sentence order", async () => {
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const tts: TtsProvider = {
      id: "mock",
      model: "slow",
      sampleRate: 24000,
      async *synthesize(text) {
        active++;
        peak = Math.max(peak, active);
        started.push(text);
        try {
          await pause(20);
          yield new Uint8Array(480);
        } finally {
          active--;
        }
      },
    };
    const events = await collect(runAssistant({ ...base, transcript: "Count to five." }, deps({ tts, llm: chatty }), new AbortController().signal));
    expect(events.at(-1)!.t).toBe("done");
    expect(peak).toBe(2);
    expect(started).toEqual(FIVE);
    const audioOrder = events.flatMap((e) => (e.t === "audio" ? [e.i] : []));
    expect(audioOrder).toEqual([0, 1, 2, 3, 4]);
  });

  it("retries a sentence once when it fails before any audio", async () => {
    const calls: string[] = [];
    const tts: TtsProvider = {
      id: "mock",
      model: "flaky",
      sampleRate: 24000,
      async *synthesize(text) {
        calls.push(text);
        if (calls.filter((c) => c === text).length === 1 && text === FIVE[1]) throw new ProviderError("mock", "timeout");
        yield new Uint8Array(480);
      },
    };
    const events = await collect(runAssistant({ ...base, transcript: "Count to five." }, deps({ tts, llm: chatty }), new AbortController().signal));
    expect(events.at(-1)!.t).toBe("done");
    expect(calls.filter((c) => c === FIVE[1])).toHaveLength(2);
    expect(events.filter((e) => e.t === "audio")).toHaveLength(5);
  });

  it("gives up on a sentence after three failed attempts, and never repeats audio", async () => {
    const oneLine: LlmProvider = { ...chatty, streamAssistantReply: async function* () { yield { type: "text" as const, delta: "Hello." }; } };
    let down = 0;
    const always: TtsProvider = {
      id: "mock",
      model: "down",
      sampleRate: 24000,
      // eslint-disable-next-line require-yield
      async *synthesize() {
        down++;
        throw new ProviderError("mock", "upstream", 503);
      },
    };
    let drops = 0;
    const halfway: TtsProvider = {
      id: "mock",
      model: "drops",
      sampleRate: 24000,
      async *synthesize() {
        drops++;
        yield new Uint8Array(480);
        throw new ProviderError("mock", "network");
      },
    };
    const a = await collect(runAssistant({ ...base, transcript: "Hi." }, deps({ tts: always, llm: oneLine }), new AbortController().signal));
    expect(a.at(-1)).toEqual({ t: "error", code: "provider_upstream" });
    expect(down).toBe(3);
    const b = await collect(runAssistant({ ...base, transcript: "Hi." }, deps({ tts: halfway, llm: oneLine }), new AbortController().signal));
    expect(b.at(-1)).toEqual({ t: "error", code: "provider_network" });
    expect(drops).toBe(1);
  });

  it("sends a second request when a sentence's audio does not start", async () => {
    let calls = 0;
    const stuckOnce: TtsProvider = {
      id: "mock",
      model: "stuck-once",
      sampleRate: 24000,
      async *synthesize(_text, opts) {
        if (calls++ === 0) await new Promise((_, reject) => opts.signal?.addEventListener("abort", () => reject(opts.signal!.reason)));
        yield new Uint8Array(480);
      },
    };
    const started = performance.now();
    const events = await collect(runAssistant({ ...base, transcript: "Hi." }, deps({ tts: stuckOnce, llm: chatty }), new AbortController().signal));
    expect(events.at(-1)!.t).toBe("done");
    expect(events.filter((e) => e.t === "audio")).toHaveLength(5);
    // One hedge after about two seconds, not a timeout.
    expect(calls).toBe(6);
    expect(performance.now() - started).toBeLessThan(4000);
  });

  it("rewind: recaps what was heard in the asked language, with the recap prompt and no tools", async () => {
    let seen: AssistantReplyParams | undefined;
    const spy: LlmProvider = {
      ...chatty,
      streamAssistantReply(p) {
        seen = p;
        return new MockLlm().streamAssistantReply(p);
      },
    };
    const events = await collect(
      runAssistant({ ...base, audio: speech(), mode: "rewind", replyLang: "tr", seconds: 15 }, deps({ llm: spy }), new AbortController().signal),
    );
    expect(events[0]).toMatchObject({ t: "transcript" });
    expect(seen!.system).toContain("rewound the last 15 seconds");
    expect(seen!.system).toContain("Speak Turkish");
    expect(seen!.tools).toBeUndefined();
    expect(seen!.history).toEqual([]);
    expect(seen!.user).toMatch(/^<transcript>\n[\s\S]+\n<\/transcript>$/);
    expect(events.at(-1)).toMatchObject({ t: "done", language: "tr" });
    expect((events.at(-1) as { reply: string }).reply).toContain("Etrafınızda şu söylendi");
  });

  it("rewind: seconds without speech get a spoken line instead of no_speech, without the LLM", async () => {
    let called = false;
    const spy: LlmProvider = {
      ...chatty,
      // eslint-disable-next-line require-yield
      async *streamAssistantReply() {
        called = true;
      },
    };
    const silent = { data: encodeWav(new Float32Array(16000), 16000), mimeType: "audio/wav", durationMs: 1000 };
    const events = await collect(
      runAssistant({ ...base, audio: silent, mode: "rewind", replyLang: "en", seconds: 10 }, deps({ llm: spy }), new AbortController().signal),
    );
    expect(events.some((e) => e.t === "no_speech")).toBe(false);
    expect(called).toBe(false);
    expect(events.at(-1)).toMatchObject({ t: "done", reply: "I couldn't make out any speech in those seconds.", language: "en" });
    expect(events.some((e) => e.t === "audio")).toBe(true);
  });

  it("stops when aborted", async () => {
    const ac = new AbortController();
    const out: AssistantEvent[] = [];
    for await (const e of runAssistant({ ...base, transcript: "Tell me something long please." }, deps(), ac.signal)) {
      out.push(e);
      if (e.t === "sentence") ac.abort();
    }
    expect(out.some((e) => e.t === "done")).toBe(false);
  });
});
