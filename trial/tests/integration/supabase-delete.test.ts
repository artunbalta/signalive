/**
 * Delete everything, against a real Supabase project: rows, stored objects
 * (through the Storage API), and the auth user.
 *
 *   SUPABASE_TEST_URL=... SUPABASE_TEST_PUBLISHABLE_KEY=... SUPABASE_TEST_SECRET_KEY=... npm run test:supabase
 *
 * Use a throwaway project with the migration applied and anonymous sign in
 * enabled. Skipped when the variables are not set. The local Postgres tests
 * (npm run test:db) cover the same rules in SQL; this one adds the Storage
 * API and Auth, which a plain Postgres cannot emulate.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SupabaseStore } from "@/lib/server/store/supabase";
import { encodeWav } from "@/lib/shared/audio/wav";
import { hashEmbedding } from "@/lib/server/providers/mock";

const url = process.env.SUPABASE_TEST_URL;
const publishable = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_TEST_SECRET_KEY;
const TABLES = [
  "sessions", "device_profiles", "consents", "audio_objects", "utterances",
  "notes", "note_embeddings", "marks", "lab_runs", "lab_results", "latency_events",
];

describe.skipIf(!url || !publishable || !secret)("Supabase: delete everything", () => {
  it("removes every row, every stored object and the auth user", async () => {
    const browser = createClient(url!, publishable!, { auth: { persistSession: false } });
    const { data, error } = await browser.auth.signInAnonymously();
    expect(error).toBeNull();
    const token = data.session!.access_token;
    const userId = data.user!.id;

    const store = new SupabaseStore(url!, publishable!, secret!);
    const auth = await store.verify(token);
    expect(auth?.userId).toBe(userId);
    const s = store.forUser(auth!);

    const session = await s.createSession({ uiLang: "tr", speechLang: "tr", browser: "test", os: "test" });
    await s.recordConsent("terms", "test", true);
    await s.recordConsent("lab_audio", "test", true);
    const profile = await s.saveDeviceProfile({
      sessionId: session.id, inputLabel: "test", outputLabel: null, trackSampleRate: 16000, contextSampleRate: 48000,
      channelCount: 1, browser: "test", os: "test", isMobile: false, bluetoothSuspected: true, handsFreeSuspected: true,
      effectiveBandwidthHz: 8000, rmsDbfs: -20, peakDbfs: -3, noiseFloorDbfs: -60, windLowFreqRatio: 0.1,
      outputSelectable: false, mediaKeys: {}, extra: {},
    });
    const audio = await s.putAudio({ kind: "lab", bytes: encodeWav(new Float32Array(1600), 16000), durationMs: 100, sampleRate: 16000, expiresAt: null });
    const now = new Date().toISOString();
    await s.insertUtterances([{ sessionId: session.id, source: "recorder", role: "user", text: "toplantı yarın", language: "tr", startedAt: now, endedAt: now, durationMs: 1, sttProvider: "test", sttModel: "test", confidence: null, audioObjectId: audio.id }]);
    const note = await s.insertNote(
      { title: "Toplantı", summary: "Yarın toplantı var.", action_items: [], topics: ["toplantı"], people_mentioned: [], language: "tr", sessionId: session.id, source: "batch", periodStart: now, periodEnd: now, utteranceIds: [], model: "test" },
      { model: "mock-hash-1024", vector: hashEmbedding("toplantı yarın") },
    );
    await s.insertMark({ sessionId: session.id, startAt: now, endAt: now, label: null, noteId: note.id });
    const run = await s.createLabRun({ sessionId: session.id, deviceProfileId: profile.id, deviceLabel: "test", language: "tr", voiceStyle: "whisper", environment: "street", chains: ["raw"], providers: ["mock"], phraseSetVersion: "v1", storeAudio: true, dualCapture: false });
    await s.insertLabResults([{ runId: run.id, takeId: randomUUID(), phraseId: "tr-01", language: "tr", voiceStyle: "whisper", environment: "street", deviceLabel: "test", chain: "raw", provider: "mock", model: "m", reference: "a", hypothesis: "a", refWords: 1, refChars: 1, substitutions: 0, deletions: 0, insertions: 0, charErrors: 0, wer: 0, cer: 0, sttLatencyMs: 1, audioMs: 1, rmsDbfs: null, snrDbEstimate: null, lowFreqRatio: null, audioObjectId: audio.id, error: null }]);
    await s.insertLatencyEvent({ sessionId: session.id, turnId: randomUUID(), kind: "turn", inputMode: "ptt", whisper: false, language: "tr", sttProvider: "test", sttMode: "batch", llmModel: "test", ttsProvider: "test", endpointingMs: 1, sttFinalMs: 1, llmFirstTokenMs: 1, firstSentenceMs: 1, ttsFirstAudioMs: 1, playbackStartMs: 1, sinceLandingMs: null, bargeIn: false, errorCode: null });

    const hits = await s.searchNotes({ tsquery: "toplanti:*", embedding: hashEmbedding("toplantı"), embeddingModel: "mock-hash-1024", limit: 5 });
    expect(hits.map((h) => h.note.id)).toContain(note.id);

    const report = await s.deleteAll();
    expect(report.storageObjects).toBeGreaterThanOrEqual(1);
    expect(report.authUserDeleted).toBe(true);

    const admin = createClient(url!, secret!, { auth: { persistSession: false } });
    for (const t of TABLES) {
      const { count } = await admin.from(t).select("*", { count: "exact", head: true }).eq("user_id", userId);
      expect(count, t).toBe(0);
    }
    const { data: files } = await admin.storage.from("audio").list(`${userId}/lab`);
    expect(files ?? []).toHaveLength(0);
    const { data: user } = await admin.auth.admin.getUserById(userId);
    expect(user.user).toBeNull();
  });
});
