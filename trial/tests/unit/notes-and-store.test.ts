import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeNote } from "@/lib/server/notes";
import { MockEmbeddings, MockLlm } from "@/lib/server/providers/mock";
import { ProviderError, type EmbeddingProvider, type ExtractParams, type LlmProvider } from "@/lib/server/providers/types";
import { MemoryStore } from "@/lib/server/store/memory";
import type { UserStore } from "@/lib/server/store/types";
import { buildTsQuery } from "@/lib/shared/notes";
import { exportToMarkdown } from "@/lib/shared/export-md";
import { encodeWav } from "@/lib/shared/audio/wav";
import type { NoteContent } from "@/lib/shared/types";

// En dash and em dash, built from code points so this file contains neither.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const store = new MemoryStore();
const userStore = (): UserStore => {
  const id = randomUUID();
  return store.forUser({ userId: id, accessToken: `dev.${id}`, isAnonymous: true });
};

const VALID: NoteContent = {
  title: "Bütçe toplantısı Cuma",
  summary: "Bütçe toplantısı Cuma saat üçe taşındı. Elif slaytları gönderecek.",
  action_items: ["Mekânı yarın sabah ara"],
  topics: ["bütçe", "toplantı"],
  people_mentioned: ["Elif"],
  language: "tr",
};

/** An LLM that returns the given outputs in turn. */
function scriptedLlm(outputs: unknown[]): LlmProvider & { calls: number } {
  const llm = {
    id: "mock" as const,
    model: "scripted",
    calls: 0,
    async *streamAssistantReply() {},
    async extractStructured<T>(_p: ExtractParams<T>): Promise<T | null> {
      return (outputs[llm.calls++] ?? null) as T | null;
    },
  };
  return llm;
}

async function seed(s: UserStore) {
  const session = await s.createSession({ uiLang: "tr", speechLang: "tr", browser: "Chrome", os: "macOS" });
  const t = Date.now();
  const at = (sec: number) => new Date(t + sec * 1000).toISOString();
  await s.insertUtterances(
    [
      "Bütçe toplantısını Cuma saat üçe taşıyalım.",
      "Elif slaytları gönderecek.",
      "Yarın sabah mekânı aramam lazım.",
    ].map((text, i) => ({
      sessionId: session.id,
      source: "recorder" as const,
      role: "user" as const,
      text,
      language: "tr" as const,
      startedAt: at(i * 5),
      endedAt: at(i * 5 + 4),
      durationMs: 4000,
      sttProvider: "mock",
      sttModel: "mock-stt",
      confidence: null,
      audioObjectId: null,
    })),
  );
  return session;
}

describe("makeNote", () => {
  it("retries once when the output fails validation, then stores the note", async () => {
    const s = userStore();
    const session = await seed(s);
    const llm = scriptedLlm([{ title: "", summary: "x" }, VALID]);
    const note = await makeNote(s, llm, new MockEmbeddings(), { sessionId: session.id, source: "batch" });
    expect(llm.calls).toBe(2);
    expect(note.title).toBe(VALID.title);
    expect(note.utteranceIds).toHaveLength(3);
    expect(note.periodStart! <= note.periodEnd!).toBe(true);
  });

  it("gives up after the second invalid output and stores nothing", async () => {
    const s = userStore();
    const session = await seed(s);
    const llm = scriptedLlm([{ nope: true }, { ...VALID, language: "de" }]);
    await expect(makeNote(s, llm, new MockEmbeddings(), { sessionId: session.id, source: "batch" })).rejects.toMatchObject({
      code: "notes_invalid",
    });
    expect(llm.calls).toBe(2);
    expect(await s.listNotes({ limit: 10 })).toHaveLength(0);
  });

  it("stores the note without a vector when embedding fails", async () => {
    const s = userStore();
    const session = await seed(s);
    const broken: EmbeddingProvider = {
      id: "mock",
      model: "broken",
      async embed() {
        throw new ProviderError("mock", "upstream", 500);
      },
    };
    await makeNote(s, scriptedLlm([VALID]), broken, { sessionId: session.id, source: "on_demand" });
    const hits = await s.searchNotes({ tsquery: buildTsQuery("toplanti"), embedding: null, embeddingModel: null, limit: 5 });
    expect(hits).toHaveLength(1);
  });

  it("refuses an empty window", async () => {
    const s = userStore();
    const session = await s.createSession({ uiLang: "en", speechLang: "en", browser: "x", os: "y" });
    await expect(makeNote(s, new MockLlm(), new MockEmbeddings(), { sessionId: session.id, source: "batch" })).rejects.toMatchObject({
      code: "nothing_to_summarize",
    });
  });

  it("attaches the note to a mark", async () => {
    const s = userStore();
    const session = await seed(s);
    const mark = await s.insertMark({ sessionId: session.id, startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + 60_000).toISOString(), label: null, noteId: null });
    const note = await makeNote(s, scriptedLlm([VALID]), new MockEmbeddings(), { sessionId: session.id, source: "mark", markId: mark.id });
    const bundle = await s.exportAll();
    expect(bundle.marks[0]!.noteId).toBe(note.id);
  });
});

describe("memory store", () => {
  it("finds Turkish words by prefix, without Turkish letters, and by meaning", async () => {
    const s = userStore();
    const session = await seed(s);
    await makeNote(s, scriptedLlm([VALID]), new MockEmbeddings(), { sessionId: session.id, source: "batch" });
    for (const q of ["toplantı", "toplanti", "TOPLANTI", "butce", "Elif"]) {
      const hits = await s.searchNotes({ tsquery: buildTsQuery(q), embedding: null, embeddingModel: null, limit: 5 });
      expect(hits, q).toHaveLength(1);
    }
    const [vector] = await new MockEmbeddings().embed(["bütçe toplantısı ne zaman"]);
    const semantic = await s.searchNotes({ tsquery: null, embedding: vector!, embeddingModel: "mock-hash-1024", limit: 5 });
    expect(semantic[0]?.semanticSimilarity).toBeGreaterThan(0);
    const otherModel = await s.searchNotes({ tsquery: null, embedding: vector!, embeddingModel: "other", limit: 5 });
    expect(otherModel).toHaveLength(0);
  });

  it("keeps users apart", async () => {
    const a = userStore();
    const b = userStore();
    const session = await seed(a);
    await makeNote(a, scriptedLlm([VALID]), new MockEmbeddings(), { sessionId: session.id, source: "batch" });
    expect(await b.listNotes({ limit: 10 })).toHaveLength(0);
    expect(await b.searchNotes({ tsquery: buildTsQuery("toplanti"), embedding: null, embeddingModel: null, limit: 5 })).toHaveLength(0);
    // A user cannot attach rows to someone else's session.
    await expect(
      b.insertMark({ sessionId: session.id, startAt: new Date().toISOString(), endAt: new Date().toISOString(), label: null, noteId: null }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("delete everything removes every row and stored object, and nothing of other users", async () => {
    const victim = userStore();
    const bystander = userStore();
    for (const s of [victim, bystander]) {
      const session = await seed(s);
      const mark = await s.insertMark({ sessionId: session.id, startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + 60_000).toISOString(), label: null, noteId: null });
      await makeNote(s, scriptedLlm([VALID]), new MockEmbeddings(), { sessionId: session.id, source: "mark", markId: mark.id });
      await s.recordConsent("terms", "v1", true);
      const profile = await s.saveDeviceProfile({
        sessionId: session.id, inputLabel: "AirPods", outputLabel: null, trackSampleRate: 16000, contextSampleRate: 48000,
        channelCount: 1, browser: "Chrome", os: "iOS", isMobile: true, bluetoothSuspected: true, handsFreeSuspected: true,
        effectiveBandwidthHz: 8000, rmsDbfs: -20, peakDbfs: -3, noiseFloorDbfs: -60, windLowFreqRatio: 0.2,
        outputSelectable: false, mediaKeys: {}, extra: {},
      });
      const audio = await s.putAudio({ kind: "lab", bytes: encodeWav(new Float32Array(160), 16000), durationMs: 10, sampleRate: 16000, expiresAt: null });
      const run = await s.createLabRun({
        sessionId: session.id, deviceProfileId: profile.id, deviceLabel: "AirPods", language: "tr", voiceStyle: "whisper",
        environment: "street", chains: ["raw"], providers: ["mock"], phraseSetVersion: "v1", storeAudio: true, dualCapture: false,
      });
      await s.insertLabResults([{
        runId: run.id, takeId: randomUUID(), phraseId: "tr-01", language: "tr", voiceStyle: "whisper", environment: "street",
        deviceLabel: "AirPods", chain: "raw", provider: "mock", model: "m", reference: "a", hypothesis: "a", refWords: 1,
        refChars: 1, substitutions: 0, deletions: 0, insertions: 0, charErrors: 0, wer: 0, cer: 0, sttLatencyMs: 10,
        audioMs: 10, rmsDbfs: -20, snrDbEstimate: 30, lowFreqRatio: 0.1, audioObjectId: audio.id, error: null,
      }]);
      await s.insertLatencyEvent({
        sessionId: session.id, turnId: randomUUID(), kind: "turn", inputMode: "ptt", whisper: false, language: "tr",
        sttProvider: "mock", sttMode: "batch", llmModel: "m", ttsProvider: "mock", endpointingMs: 1, sttFinalMs: 1,
        llmFirstTokenMs: 1, firstSentenceMs: 1, ttsFirstAudioMs: 1, playbackStartMs: 1, sinceLandingMs: null, bargeIn: false, errorCode: null,
      });
    }

    const before = await victim.exportAll();
    const report = await victim.deleteAll();
    expect(report.storageObjects).toBe(1);
    for (const [table, n] of Object.entries(report.rows)) expect(n, table).toBeGreaterThan(0);
    expect(report.rows.notes).toBe(before.notes.length);

    const after = await victim.exportAll();
    for (const key of ["sessions", "deviceProfiles", "consents", "utterances", "marks", "notes", "labRuns", "labResults", "latencyEvents", "audioObjects"] as const) {
      expect(after[key], key).toHaveLength(0);
    }
    expect(await victim.getAudio(before.audioObjects[0]!.id)).toBeNull();

    const other = await bystander.exportAll();
    expect(other.notes).toHaveLength(1);
    expect(other.audioObjects).toHaveLength(1);
    expect(await bystander.getAudio(other.audioObjects[0]!.id)).not.toBeNull();
  });

  it("expires audio past its retention date and clears the references", async () => {
    const s = userStore();
    const session = await seed(s);
    const old = await s.putAudio({ kind: "recorder", bytes: encodeWav(new Float32Array(16), 16000), durationMs: 1, sampleRate: 16000, expiresAt: new Date(Date.now() - 1000).toISOString() });
    const fresh = await s.putAudio({ kind: "recorder", bytes: encodeWav(new Float32Array(16), 16000), durationMs: 1, sampleRate: 16000, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await s.insertUtterances([{ sessionId: session.id, source: "recorder", role: "user", text: "x", language: "en", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1, sttProvider: null, sttModel: null, confidence: null, audioObjectId: old.id }]);
    const { removed } = await store.admin().expireAudio(new Date());
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await s.getAudio(old.id)).toBeNull();
    expect(await s.getAudio(fresh.id)).not.toBeNull();
    const utterances = await s.listUtterances({});
    expect(utterances.find((u) => u.text === "x")!.audioObjectId).toBeNull();
  });
});

describe("markdown export", () => {
  it("renders notes, transcripts and a measurement summary", async () => {
    const s = userStore();
    const session = await seed(s);
    await makeNote(s, scriptedLlm([VALID]), new MockEmbeddings(), { sessionId: session.id, source: "batch" });
    const md = exportToMarkdown(await s.exportAll());
    expect(md).toContain("# Signalive trial export");
    expect(md).toContain("### Bütçe toplantısı Cuma");
    expect(md).toContain("- Mekânı yarın sabah ara");
    expect(md).toContain("**Recorded:** Elif slaytları gönderecek.");
    expect(md).toContain("## Measurements");
    expect(md).not.toMatch(DASHES);
  });
});
