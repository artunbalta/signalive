import { describe, expect, it } from "vitest";
import { runMoment, toMomentContent, type MomentDeps } from "@/lib/server/moments-pipeline";
import { MockLlm, MockStt, MockTts } from "@/lib/server/providers/mock";
import {
  ProviderError,
  type ExtractParams,
  type LlmProvider,
  type SttProvider,
  type TtsProvider,
} from "@/lib/server/providers/types";
import { encodeWav } from "@/lib/shared/audio/wav";
import { MomentContentSchema, type MomentRequestMeta, type MomentStreamEvent } from "@/lib/shared/moments";

const SAID = "Let's move the budget review to Friday at three. Elif, you need to send the slides by Thursday.";

const META: MomentRequestMeta = {
  speechLang: "en",
  replyLang: "en",
  now: "2026-11-02T14:05:00+03:00",
  timeZone: "Europe/Istanbul",
  place: "Moda, Kadıköy",
  trigger: "clench",
  speak: false,
};

const tone = (seconds = 2) => {
  const x = new Float32Array(16000 * seconds);
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 16000);
  return { data: encodeWav(x, 16000), mimeType: "audio/wav", durationMs: seconds * 1000 };
};
const silence = () => ({ data: encodeWav(new Float32Array(16000), 16000), mimeType: "audio/wav", durationMs: 1000 });

/** Recognizes every clip as the given text. */
const saying = (text: string, language: "en" | "tr" | null = "en"): SttProvider => ({
  id: "mock",
  model: "said",
  capabilities: { streaming: false, browserStreaming: false, streamingLanguages: [], autoDetect: true },
  async transcribeFile() {
    return { text, language, confidence: null, provider: "mock", model: "said", latencyMs: 5 };
  },
  async *transcribeStream() {
    yield { type: "final" as const, text, language, confidence: null };
  },
});

/** An LLM that answers extractions with the given outputs in turn, and records what it was asked. */
function scripted(outputs: unknown[]): LlmProvider & { asked: ExtractParams<unknown>[] } {
  const llm = {
    id: "mock" as const,
    model: "scripted",
    asked: [] as ExtractParams<unknown>[],
    async *streamAssistantReply() {},
    async extractStructured<T>(p: ExtractParams<T>): Promise<T | null> {
      llm.asked.push(p as ExtractParams<unknown>);
      return (outputs[llm.asked.length - 1] ?? null) as T | null;
    },
  };
  return llm;
}

const deps = (over: Partial<MomentDeps> = {}): MomentDeps => ({
  stt: over.stt ?? saying(SAID),
  llm: over.llm ?? new MockLlm(),
  tts: over.tts ?? new MockTts(),
});

async function collect(gen: AsyncIterable<MomentStreamEvent>) {
  const out: MomentStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const momentOf = (events: MomentStreamEvent[]) => events.find((e): e is Extract<MomentStreamEvent, { t: "moment" }> => e.t === "moment")!;

describe("runMoment", () => {
  it("streams the transcript, then the moment in the reply language, then done", async () => {
    const events = await collect(runMoment({ audio: tone(), meta: META }, deps(), new AbortController().signal));
    expect(events.map((e) => e.t)).toEqual(["transcript", "moment", "done"]);
    expect(events[0]).toMatchObject({ t: "transcript", text: SAID, language: "en" });
    const { content, model } = momentOf(events);
    expect(MomentContentSchema.parse(content)).toEqual(content);
    expect(model).toBe("mock-llm");
    expect(content.title).toBe("Let's move the budget review to");
    expect(content.summary).toMatch(/^Mock summary\. /);
    expect(content.actionItems).toEqual([{ text: "Elif, you need to send the slides by Thursday.", due: null }]);
    expect(content.people).toContain("Elif");
    expect(content.language).toBe("en");
    expect((events.at(-1) as { totalMs: number }).totalMs).toBeGreaterThan(0);
  });

  it("speaks a confirmation as sentences and audio, without text events", async () => {
    const events = await collect(runMoment({ audio: tone(), meta: { ...META, speak: true } }, deps(), new AbortController().signal));
    expect(events.slice(0, 2).map((e) => e.t)).toEqual(["transcript", "moment"]);
    expect(events.some((e) => e.t === "text")).toBe(false);
    const sentences = events.flatMap((e) => (e.t === "sentence" ? [e.text] : []));
    expect(sentences).toEqual(["Saved: Let's move the budget review to.", "To do: Elif, you need to send the slides by Thursday."]);
    const audio = events.filter((e): e is Extract<MomentStreamEvent, { t: "audio" }> => e.t === "audio");
    expect(audio.length).toBeGreaterThan(0);
    expect(audio[0]!.sr).toBe(24000);
    for (let i = 1; i < audio.length; i++) expect(audio[i]!.i).toBeGreaterThanOrEqual(audio[i - 1]!.i);
    expect(events.at(-1)!.t).toBe("done");
  });

  it("writes and speaks in Turkish when asked, whatever was spoken", async () => {
    const events = await collect(
      runMoment({ audio: tone(), meta: { ...META, replyLang: "tr", speak: true } }, deps(), new AbortController().signal),
    );
    const { content } = momentOf(events);
    expect(content.language).toBe("tr");
    expect(content.summary).toMatch(/^Deneme özeti\. /);
    expect(events.find((e) => e.t === "sentence")).toMatchObject({ text: "Kaydedildi: Let's move the budget review to." });
  });

  it("reports no speech without calling the language model, and says so when asked to speak", async () => {
    const llm = scripted([]);
    const quiet = await collect(runMoment({ audio: silence(), meta: META }, deps({ stt: new MockStt(), llm }), new AbortController().signal));
    expect(quiet.map((e) => e.t)).toEqual(["transcript", "no_speech", "done"]);
    const spoken = await collect(
      runMoment({ audio: silence(), meta: { ...META, speak: true, replyLang: "tr" } }, deps({ stt: new MockStt(), llm }), new AbortController().signal),
    );
    expect(spoken.slice(0, 2).map((e) => e.t)).toEqual(["transcript", "no_speech"]);
    expect(spoken.find((e) => e.t === "sentence")).toMatchObject({ text: "O saniyelerde anlaşılır bir konuşma duyamadım, bir şey kaydedilmedi." });
    expect(spoken.some((e) => e.t === "audio")).toBe(true);
    expect(spoken.at(-1)!.t).toBe("done");
    expect(llm.asked).toHaveLength(0);
  });

  it("asks once more after an unusable answer, then gives up with moment_invalid", async () => {
    const valid = { title: "Budget review", summary: "It moved to Friday.", keyPoints: [], actionItems: [], people: [], topics: [], language: "en" };
    const retried = scripted([{ title: "", summary: "x" }, valid]);
    const ok = await collect(runMoment({ audio: tone(), meta: META }, deps({ llm: retried }), new AbortController().signal));
    expect(momentOf(ok).content.title).toBe("Budget review");
    expect(retried.asked).toHaveLength(2);
    expect(retried.asked[1]!.user).toContain("did not match the required format");

    const hopeless = scripted([{ nope: true }, { ...valid, summary: "   " }]);
    const failed = await collect(runMoment({ audio: tone(), meta: META }, deps({ llm: hopeless }), new AbortController().signal));
    expect(failed.map((e) => e.t)).toEqual(["transcript", "error"]);
    expect(failed.at(-1)).toEqual({ t: "error", code: "moment_invalid" });
  });

  it("gives the model the reply language, the wearer's clock with its offset, and the place as context only", async () => {
    const llm = scripted([]);
    await collect(runMoment({ audio: tone(), meta: { ...META, replyLang: "tr" } }, deps({ llm }), new AbortController().signal));
    const { system, user } = llm.asked[0]!;
    expect(system).toContain("Write every text field in Turkish");
    expect(system).toContain("Monday 2026-11-02T14:05:00+03:00 (Europe/Istanbul)");
    expect(system).toContain("Where the wearer was: Moda, Kadıköy. Use it only to understand words like \"here\"");
    expect(user).toBe(`<transcript>\n${SAID}\n</transcript>`);
    const placeless = scripted([]);
    await collect(runMoment({ audio: tone(), meta: { ...META, place: null } }, deps({ llm: placeless }), new AbortController().signal));
    expect(placeless.asked[0]!.system).not.toContain("Where the wearer was");
  });

  it("turns a recognizer failure into an error event", async () => {
    const broken: SttProvider = {
      ...saying(SAID),
      async transcribeFile() {
        throw new ProviderError("mock", "auth", 401);
      },
    };
    const events = await collect(runMoment({ audio: tone(), meta: META }, deps({ stt: broken }), new AbortController().signal));
    expect(events).toEqual([{ t: "error", code: "provider_auth" }]);
  });

  it("keeps the moment when only the spoken confirmation fails", async () => {
    const mute: TtsProvider = {
      id: "mock",
      model: "mute",
      sampleRate: 24000,
      // eslint-disable-next-line require-yield
      async *synthesize() {
        throw new ProviderError("mock", "auth", 401);
      },
    };
    const events = await collect(runMoment({ audio: tone(), meta: { ...META, speak: true } }, deps({ tts: mute }), new AbortController().signal));
    expect(events.map((e) => e.t)).toContain("moment");
    expect(events.at(-1)).toEqual({ t: "error", code: "provider_auth" });
    expect(events.some((e) => e.t === "done")).toBe(false);
  });

  it("stops when aborted", async () => {
    const ac = new AbortController();
    const out: MomentStreamEvent[] = [];
    for await (const e of runMoment({ audio: tone(), meta: { ...META, speak: true } }, deps(), ac.signal)) {
      out.push(e);
      if (e.t === "moment") ac.abort();
    }
    expect(out.some((e) => e.t === "done")).toBe(false);
  });
});

describe("toMomentContent", () => {
  const raw = {
    title: "  Budget   review moved to Friday.  ",
    summary: "Someone moved the review.\n\nElif sends the slides.",
    keyPoints: ["Friday at three", "", "friday at three"],
    actionItems: [
      { text: "Send the slides", due: "2026-11-05T17:00" },
      { text: "Book the room", due: "2026-11-06" },
      { text: "Call the venue", due: "next Friday" },
      { text: "   ", due: null },
    ],
    people: ["Elif", "elif", "Can"],
    topics: ["budget"],
    language: "tr",
  };

  it("tidies the answer and holds it to the contract", () => {
    const content = toMomentContent(raw, "en", "Europe/Istanbul")!;
    expect(content.title).toBe("Budget review moved to Friday");
    expect(content.summary).toBe("Someone moved the review. Elif sends the slides.");
    expect(content.keyPoints).toEqual(["Friday at three"]);
    expect(content.actionItems).toEqual([
      { text: "Send the slides", due: "2026-11-05T17:00:00+03:00" },
      { text: "Book the room", due: "2026-11-06" },
      { text: "Call the venue", due: null },
    ]);
    expect(content.people).toEqual(["Elif", "Can"]);
    // The language asked for, not the one the model claimed.
    expect(content.language).toBe("en");
  });

  it("cuts text that runs over its limit at a word, and caps the lists", () => {
    const long = toMomentContent(
      { ...raw, title: "word ".repeat(40), keyPoints: Array.from({ length: 9 }, (_, i) => `point ${i}`) },
      "en",
      null,
    )!;
    expect(long.title.length).toBeLessThanOrEqual(120);
    expect(long.title.endsWith("word…")).toBe(true);
    expect(long.keyPoints).toHaveLength(6);
    expect(MomentContentSchema.safeParse(long).success).toBe(true);
  });

  it("refuses an answer without a title or a summary, or of another shape", () => {
    expect(toMomentContent({ ...raw, title: " " }, "en", null)).toBeNull();
    expect(toMomentContent({ ...raw, summary: "" }, "en", null)).toBeNull();
    expect(toMomentContent({ title: "x" }, "en", null)).toBeNull();
    expect(toMomentContent(null, "en", null)).toBeNull();
  });
});
