import "server-only";
import { randomUUID } from "node:crypto";
import { noteSearchText } from "@/lib/shared/notes";
import type {
  AudioObject,
  ConsentKind,
  ConsentRecord,
  DeleteReport,
  DeviceProfile,
  DeviceProfileInput,
  ExportBundle,
  LabResult,
  LabRun,
  LatencyEvent,
  LatencyEventInput,
  Mark,
  Note,
  NoteSearchHit,
  Session,
  Utterance,
} from "@/lib/shared/types";
import {
  StoreError,
  type AdminStore,
  type AuthContext,
  type DataStore,
  type NewAudio,
  type NewLabResult,
  type NewLabRun,
  type NewMark,
  type NewNote,
  type NewSession,
  type NewUtterance,
  type NoteQuery,
  type UserStore,
} from "./types";

/**
 * In-process store for development and automated tests. Same contract as the
 * Supabase store: everything is scoped to one user, and a row may only refer
 * to rows of the same user. Data lives as long as the server process, and
 * every server instance has its own copy, so it is refused in production
 * unless ALLOW_MEMORY_STORE is set for a throwaway demo.
 *
 * Dev auth: the browser sends "dev.<uuid>" as its bearer token. That is not
 * authentication, which is exactly why this store never runs by accident.
 */

interface UserData {
  sessions: Session[];
  deviceProfiles: DeviceProfile[];
  consents: ConsentRecord[];
  utterances: Utterance[];
  marks: Mark[];
  notes: (Note & { searchText: string })[];
  embeddings: { noteId: string; model: string; vector: number[] }[];
  labRuns: LabRun[];
  labResults: LabResult[];
  latencyEvents: LatencyEvent[];
  audioObjects: AudioObject[];
  audioBytes: Map<string, Uint8Array>;
}

const emptyUser = (): UserData => ({
  sessions: [],
  deviceProfiles: [],
  consents: [],
  utterances: [],
  marks: [],
  notes: [],
  embeddings: [],
  labRuns: [],
  labResults: [],
  latencyEvents: [],
  audioObjects: [],
  audioBytes: new Map(),
});

// Survives Next.js hot reloads in development.
const g = globalThis as unknown as { __signaliveMemory?: Map<string, UserData> };
const users: Map<string, UserData> = (g.__signaliveMemory ??= new Map());

const DEV_TOKEN = /^dev\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const now = () => new Date().toISOString();
const byDateDesc = <T>(key: (t: T) => string) => (a: T, b: T) => key(b).localeCompare(key(a));
const strip = <T extends { searchText?: string }>({ searchText: _, ...rest }: T) => rest;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

class MemoryUserStore implements UserStore {
  constructor(readonly userId: string) {}

  private get d(): UserData {
    let data = users.get(this.userId);
    if (!data) {
      data = emptyUser();
      users.set(this.userId, data);
    }
    return data;
  }

  private ownSession(id: string | null) {
    if (id && !this.d.sessions.some((s) => s.id === id)) throw new StoreError("not_found", "session");
  }

  async createSession(input: NewSession): Promise<Session> {
    const s: Session = { id: randomUUID(), ...input, startedAt: now(), endedAt: null };
    this.d.sessions.push(s);
    return s;
  }

  async endSession(id: string) {
    const s = this.d.sessions.find((x) => x.id === id);
    if (s) s.endedAt = now();
  }

  async sessionLanguages(id: string) {
    const s = this.d.sessions.find((x) => x.id === id);
    return s ? { uiLang: s.uiLang, speechLang: s.speechLang } : null;
  }

  async saveDeviceProfile(input: DeviceProfileInput, id?: string): Promise<DeviceProfile> {
    this.ownSession(input.sessionId);
    const existing = id ? this.d.deviceProfiles.find((p) => p.id === id) : undefined;
    if (id && !existing) throw new StoreError("not_found", "device profile");
    if (existing) {
      Object.assign(existing, input, { updatedAt: now() });
      return { ...existing };
    }
    const p: DeviceProfile = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.d.deviceProfiles.push(p);
    return { ...p };
  }

  async getDeviceProfile(id: string) {
    return this.d.deviceProfiles.find((p) => p.id === id) ?? null;
  }

  async recordConsent(kind: ConsentKind, version: string, granted: boolean, details: Record<string, unknown> = {}) {
    const c: ConsentRecord = { id: randomUUID(), kind, version, granted, details, createdAt: now() };
    this.d.consents.push(c);
    return c;
  }

  async currentConsents() {
    const out: Partial<Record<ConsentKind, ConsentRecord>> = {};
    for (const c of this.d.consents) out[c.kind] = c;
    return out;
  }

  async insertUtterances(rows: NewUtterance[]) {
    const out = rows.map((r) => {
      this.ownSession(r.sessionId);
      if (r.audioObjectId && !this.d.audioObjects.some((a) => a.id === r.audioObjectId)) {
        throw new StoreError("not_found", "audio object");
      }
      return { ...r, id: randomUUID(), createdAt: now() };
    });
    this.d.utterances.push(...out);
    return out;
  }

  async listUtterances(opts: { sessionId?: string; from?: string; to?: string; source?: Utterance["source"]; limit?: number }) {
    return this.d.utterances
      .filter(
        (u) =>
          (!opts.sessionId || u.sessionId === opts.sessionId) &&
          (!opts.source || u.source === opts.source) &&
          (!opts.from || u.endedAt >= opts.from) &&
          (!opts.to || u.startedAt <= opts.to),
      )
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .slice(-(opts.limit ?? 500));
  }

  async insertMark(mark: NewMark): Promise<Mark> {
    this.ownSession(mark.sessionId);
    const m: Mark = { ...mark, id: randomUUID(), createdAt: now() };
    this.d.marks.push(m);
    return m;
  }

  async attachNoteToMark(markId: string, noteId: string) {
    const m = this.d.marks.find((x) => x.id === markId);
    if (!m || !this.d.notes.some((n) => n.id === noteId)) throw new StoreError("not_found");
    m.noteId = noteId;
  }

  async insertNote(note: NewNote, embedding: { model: string; vector: number[] } | null): Promise<Note> {
    this.ownSession(note.sessionId);
    const n = { ...note, id: randomUUID(), createdAt: now(), searchText: noteSearchText(note) };
    this.d.notes.push(n);
    if (embedding) this.d.embeddings.push({ noteId: n.id, model: embedding.model, vector: embedding.vector });
    return strip(n);
  }

  async listNotes(opts: { limit: number; before?: string }) {
    return this.d.notes
      .filter((n) => !opts.before || n.createdAt < opts.before)
      .sort(byDateDesc((n) => n.createdAt))
      .slice(0, opts.limit)
      .map(strip);
  }

  async getNotes(ids: string[]) {
    return this.d.notes.filter((n) => ids.includes(n.id)).map(strip);
  }

  /** Same ranking as public.search_notes: prefix full text and cosine, fused by reciprocal rank. */
  async searchNotes(q: NoteQuery): Promise<NoteSearchHit[]> {
    const k = Math.max(1, Math.min(q.limit, 50));
    const terms = q.tsquery ? q.tsquery.split(" & ").map((t) => t.replace(/:\*$/, "")) : [];
    const fts = terms.length
      ? this.d.notes
          .map((n) => {
            const words = n.searchText.split(" ");
            const hits = terms.map((t) => words.filter((w) => w.startsWith(t)).length);
            return { id: n.id, rank: hits.every((h) => h > 0) ? hits.reduce((a, b) => a + b, 0) / words.length : 0, at: n.createdAt };
          })
          .filter((x) => x.rank > 0)
          .sort((a, b) => b.rank - a.rank || b.at.localeCompare(a.at))
          .slice(0, k * 4)
      : [];
    const sem =
      q.embedding && q.embeddingModel
        ? this.d.embeddings
            .filter((e) => e.model === q.embeddingModel)
            .map((e) => ({ id: e.noteId, sim: cosine(e.vector, q.embedding!) }))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, k * 4)
        : [];

    const scores = new Map<string, { score: number; textRank: number | null; sim: number | null }>();
    fts.forEach((x, i) => scores.set(x.id, { score: 1 / (60 + i + 1), textRank: x.rank, sim: null }));
    sem.forEach((x, i) => {
      const s = scores.get(x.id) ?? { score: 0, textRank: null, sim: null };
      s.score += 1 / (60 + i + 1);
      s.sim = x.sim;
      scores.set(x.id, s);
    });
    return [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, k)
      .map(([id, s]) => ({
        note: strip(this.d.notes.find((n) => n.id === id)!),
        score: s.score,
        textRank: s.textRank,
        semanticSimilarity: s.sim,
      }));
  }

  async createLabRun(run: NewLabRun): Promise<LabRun> {
    this.ownSession(run.sessionId);
    if (run.deviceProfileId && !this.d.deviceProfiles.some((p) => p.id === run.deviceProfileId)) {
      throw new StoreError("not_found", "device profile");
    }
    const r: LabRun = { ...run, id: randomUUID(), startedAt: now(), completedAt: null };
    this.d.labRuns.push(r);
    return r;
  }

  async getLabRun(id: string) {
    return this.d.labRuns.find((r) => r.id === id) ?? null;
  }

  async completeLabRun(id: string) {
    const r = this.d.labRuns.find((x) => x.id === id);
    if (r) r.completedAt = now();
  }

  async listLabRuns() {
    return [...this.d.labRuns].sort(byDateDesc((r) => r.startedAt));
  }

  async insertLabResults(rows: NewLabResult[]) {
    const out = rows.map((r) => {
      if (!this.d.labRuns.some((x) => x.id === r.runId)) throw new StoreError("not_found", "lab run");
      return { ...r, id: randomUUID(), createdAt: now() };
    });
    this.d.labResults.push(...out);
    return out;
  }

  async listLabResults(opts: { runId?: string } = {}) {
    return this.d.labResults.filter((r) => !opts.runId || r.runId === opts.runId);
  }

  async deleteLabTake(takeId: string) {
    const before = this.d.labResults.length;
    this.d.labResults = this.d.labResults.filter((r) => r.takeId !== takeId);
    return before - this.d.labResults.length;
  }

  async insertLatencyEvent(e: LatencyEventInput): Promise<LatencyEvent> {
    if (e.sessionId) this.ownSession(e.sessionId);
    const ev: LatencyEvent = { ...e, id: randomUUID(), createdAt: now() };
    this.d.latencyEvents.push(ev);
    return ev;
  }

  async listLatencyEvents(limit: number) {
    return [...this.d.latencyEvents].sort(byDateDesc((e) => e.createdAt)).slice(0, limit);
  }

  async putAudio(audio: NewAudio): Promise<AudioObject> {
    const id = randomUUID();
    const obj: AudioObject = {
      id,
      kind: audio.kind,
      path: `${this.userId}/${audio.kind}/${id}.wav`,
      bytes: audio.bytes.byteLength,
      durationMs: Math.round(audio.durationMs),
      sampleRate: audio.sampleRate,
      expiresAt: audio.expiresAt,
      createdAt: now(),
    };
    this.d.audioObjects.push(obj);
    this.d.audioBytes.set(obj.path, audio.bytes);
    return obj;
  }

  async getAudio(id: string) {
    const object = this.d.audioObjects.find((a) => a.id === id);
    const bytes = object && this.d.audioBytes.get(object.path);
    return object && bytes ? { object, bytes } : null;
  }

  async exportAll(): Promise<ExportBundle> {
    const d = this.d;
    return {
      exportedAt: now(),
      userId: this.userId,
      sessions: d.sessions,
      deviceProfiles: d.deviceProfiles,
      consents: d.consents,
      utterances: d.utterances,
      marks: d.marks,
      notes: d.notes.map(strip),
      labRuns: d.labRuns,
      labResults: d.labResults,
      latencyEvents: d.latencyEvents,
      audioObjects: d.audioObjects,
    };
  }

  async deleteAll(): Promise<DeleteReport> {
    const d = this.d;
    const report: DeleteReport = {
      rows: {
        marks: d.marks.length,
        note_embeddings: d.embeddings.length,
        notes: d.notes.length,
        utterances: d.utterances.length,
        lab_results: d.labResults.length,
        lab_runs: d.labRuns.length,
        latency_events: d.latencyEvents.length,
        audio_objects: d.audioObjects.length,
        device_profiles: d.deviceProfiles.length,
        consents: d.consents.length,
        sessions: d.sessions.length,
      },
      storageObjects: d.audioBytes.size,
      authUserDeleted: true,
    };
    users.delete(this.userId);
    return report;
  }
}

class MemoryAdmin implements AdminStore {
  async listAllLabResults() {
    return [...users.entries()].flatMap(([participant, u]) => u.labResults.map((r) => ({ ...r, participant })));
  }

  async expireAudio(at: Date) {
    let removed = 0;
    const cutoff = at.toISOString();
    for (const u of users.values()) {
      const expired = u.audioObjects.filter((a) => a.expiresAt && a.expiresAt <= cutoff);
      for (const a of expired) {
        u.audioBytes.delete(a.path);
        for (const ut of u.utterances) if (ut.audioObjectId === a.id) ut.audioObjectId = null;
        for (const r of u.labResults) if (r.audioObjectId === a.id) r.audioObjectId = null;
        removed++;
      }
      u.audioObjects = u.audioObjects.filter((a) => !expired.includes(a));
    }
    return { removed };
  }

  async deleteAuthUser(userId: string) {
    return users.delete(userId);
  }
}

export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;

  async verify(token: string): Promise<AuthContext | null> {
    const m = DEV_TOKEN.exec(token);
    return m ? { userId: m[1]!.toLowerCase(), accessToken: token, isAnonymous: true } : null;
  }

  forUser(auth: AuthContext): UserStore {
    return new MemoryUserStore(auth.userId);
  }

  admin(): AdminStore {
    return new MemoryAdmin();
  }
}
