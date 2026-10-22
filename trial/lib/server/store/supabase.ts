import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
 * Supabase (Postgres + Storage + Auth).
 *
 * User requests run through a client carrying the user's own access token,
 * so every query is subject to the row level security in the migration; the
 * user id is never trusted from the request body. The secret key is used only
 * by the admin client (audio expiry, the research export, deleting the auth
 * user) and that client never carries a user token.
 *
 * TypeScript field names are the snake_case columns in camelCase, so rows are
 * mapped generically.
 */

const BUCKET = "audio";
const PAGE = 1000;
const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

type Row = Record<string, unknown>;
const HIDDEN = new Set(["user_id", "bucket", "search_text", "search_tsv"]);

function fromRow<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (!HIDDEN.has(k)) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

function toRow(obj: object): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] = v;
  }
  return out;
}

/** Postgres and PostgREST errors become codes; their messages can contain row values. */
function fail(error: { code?: string } | null, what: string): never {
  const code = error?.code ?? "";
  if (code === "23503") throw new StoreError("not_found", what);
  if (code === "42501" || code === "PGRST301") throw new StoreError("forbidden", what);
  if (code === "23505") throw new StoreError("conflict", what);
  if (code === "23514" || code === "22P02" || code === "23502") throw new StoreError("invalid", what);
  throw new StoreError("unavailable", what);
}

async function selectAll(db: SupabaseClient, table: string, order: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("*").order(order).range(from, from + PAGE - 1);
    if (error) fail(error, table);
    rows.push(...(data as Row[]));
    if (!data || data.length < PAGE) return rows;
  }
}

class SupabaseUserStore implements UserStore {
  constructor(
    readonly userId: string,
    private readonly db: SupabaseClient,
    private readonly adminStore: SupabaseAdmin | null,
  ) {}

  private async insertOne<T>(table: string, row: Row): Promise<T> {
    const { data, error } = await this.db.from(table).insert(row).select().single();
    if (error) fail(error, table);
    return fromRow<T>(data as Row);
  }

  async createSession(input: NewSession) {
    return this.insertOne<Session>("sessions", toRow(input));
  }

  async endSession(id: string) {
    const { error } = await this.db.from("sessions").update({ ended_at: new Date().toISOString() }).eq("id", id);
    if (error) fail(error, "sessions");
  }

  async sessionLanguages(id: string) {
    const { data, error } = await this.db.from("sessions").select("ui_lang, speech_lang").eq("id", id).maybeSingle();
    if (error) fail(error, "sessions");
    return data ? { uiLang: data.ui_lang, speechLang: data.speech_lang } : null;
  }

  async saveDeviceProfile(input: DeviceProfileInput, id?: string) {
    if (!id) return this.insertOne<DeviceProfile>("device_profiles", toRow(input));
    const { data, error } = await this.db
      .from("device_profiles")
      .update({ ...toRow(input), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) fail(error, "device_profiles");
    if (!data) throw new StoreError("not_found", "device profile");
    return fromRow<DeviceProfile>(data as Row);
  }

  async getDeviceProfile(id: string) {
    const { data, error } = await this.db.from("device_profiles").select("*").eq("id", id).maybeSingle();
    if (error) fail(error, "device_profiles");
    return data ? fromRow<DeviceProfile>(data as Row) : null;
  }

  async recordConsent(kind: ConsentKind, version: string, granted: boolean, details: Record<string, unknown> = {}) {
    return this.insertOne<ConsentRecord>("consents", { kind, version, granted, details });
  }

  async currentConsents() {
    const { data, error } = await this.db.from("consents").select("*").order("created_at", { ascending: true });
    if (error) fail(error, "consents");
    const out: Partial<Record<ConsentKind, ConsentRecord>> = {};
    for (const row of data as Row[]) {
      const c = fromRow<ConsentRecord>(row);
      out[c.kind] = c;
    }
    return out;
  }

  async insertUtterances(rows: NewUtterance[]) {
    if (rows.length === 0) return [];
    const { data, error } = await this.db.from("utterances").insert(rows.map(toRow)).select();
    if (error) fail(error, "utterances");
    return (data as Row[]).map((r) => fromRow<Utterance>(r));
  }

  async listUtterances(opts: { sessionId?: string; from?: string; to?: string; source?: Utterance["source"]; limit?: number }) {
    let q = this.db.from("utterances").select("*");
    if (opts.sessionId) q = q.eq("session_id", opts.sessionId);
    if (opts.source) q = q.eq("source", opts.source);
    if (opts.from) q = q.gte("ended_at", opts.from);
    if (opts.to) q = q.lte("started_at", opts.to);
    const { data, error } = await q.order("started_at", { ascending: false }).limit(opts.limit ?? 500);
    if (error) fail(error, "utterances");
    return (data as Row[]).map((r) => fromRow<Utterance>(r)).reverse();
  }

  async insertMark(mark: NewMark) {
    return this.insertOne<Mark>("marks", toRow(mark));
  }

  async attachNoteToMark(markId: string, noteId: string) {
    const { error } = await this.db.from("marks").update({ note_id: noteId }).eq("id", markId);
    if (error) fail(error, "marks");
  }

  async insertNote(note: NewNote, embedding: { model: string; vector: number[] } | null) {
    const saved = await this.insertOne<Note>("notes", { ...toRow(note), search_text: noteSearchText(note) });
    if (embedding) {
      const { error } = await this.db
        .from("note_embeddings")
        .insert({ note_id: saved.id, model: embedding.model, embedding: JSON.stringify(embedding.vector) });
      if (error) fail(error, "note_embeddings");
    }
    return saved;
  }

  async listNotes(opts: { limit: number; before?: string }) {
    let q = this.db.from("notes").select("*");
    if (opts.before) q = q.lt("created_at", opts.before);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(opts.limit);
    if (error) fail(error, "notes");
    return (data as Row[]).map((r) => fromRow<Note>(r));
  }

  async getNotes(ids: string[]) {
    if (ids.length === 0) return [];
    const { data, error } = await this.db.from("notes").select("*").in("id", ids);
    if (error) fail(error, "notes");
    return (data as Row[]).map((r) => fromRow<Note>(r));
  }

  async searchNotes(q: NoteQuery): Promise<NoteSearchHit[]> {
    const { data, error } = await this.db.rpc("search_notes", {
      query_tsquery: q.tsquery,
      query_embedding: q.embedding ? JSON.stringify(q.embedding) : null,
      embedding_model: q.embeddingModel,
      match_count: q.limit,
    });
    if (error) fail(error, "search_notes");
    const hits = data as { note_id: string; text_rank: number | null; similarity: number | null; score: number }[];
    const notes = new Map((await this.getNotes(hits.map((h) => h.note_id))).map((n) => [n.id, n]));
    return hits
      .filter((h) => notes.has(h.note_id))
      .map((h) => ({ note: notes.get(h.note_id)!, score: h.score, textRank: h.text_rank, semanticSimilarity: h.similarity }));
  }

  async createLabRun(run: NewLabRun) {
    return this.insertOne<LabRun>("lab_runs", toRow(run));
  }

  async getLabRun(id: string) {
    const { data, error } = await this.db.from("lab_runs").select("*").eq("id", id).maybeSingle();
    if (error) fail(error, "lab_runs");
    return data ? fromRow<LabRun>(data as Row) : null;
  }

  async completeLabRun(id: string) {
    const { error } = await this.db.from("lab_runs").update({ completed_at: new Date().toISOString() }).eq("id", id);
    if (error) fail(error, "lab_runs");
  }

  async listLabRuns() {
    const { data, error } = await this.db.from("lab_runs").select("*").order("started_at", { ascending: false }).limit(200);
    if (error) fail(error, "lab_runs");
    return (data as Row[]).map((r) => fromRow<LabRun>(r));
  }

  async insertLabResults(rows: NewLabResult[]) {
    if (rows.length === 0) return [];
    const { data, error } = await this.db.from("lab_results").insert(rows.map(toRow)).select();
    if (error) fail(error, "lab_results");
    return (data as Row[]).map((r) => fromRow<LabResult>(r));
  }

  async listLabResults(opts: { runId?: string } = {}) {
    if (opts.runId) {
      const { data, error } = await this.db.from("lab_results").select("*").eq("run_id", opts.runId).order("created_at");
      if (error) fail(error, "lab_results");
      return (data as Row[]).map((r) => fromRow<LabResult>(r));
    }
    return (await selectAll(this.db, "lab_results", "created_at")).map((r) => fromRow<LabResult>(r));
  }

  async deleteLabTake(takeId: string) {
    const { data, error } = await this.db.from("lab_results").delete().eq("take_id", takeId).select("id");
    if (error) fail(error, "lab_results");
    return (data as Row[]).length;
  }

  async insertLatencyEvent(e: LatencyEventInput) {
    return this.insertOne<LatencyEvent>("latency_events", toRow(e));
  }

  async listLatencyEvents(limit: number) {
    const { data, error } = await this.db
      .from("latency_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error, "latency_events");
    return (data as Row[]).map((r) => fromRow<LatencyEvent>(r));
  }

  async putAudio(audio: NewAudio): Promise<AudioObject> {
    const id = randomUUID();
    const path = `${this.userId}/${audio.kind}/${id}.wav`;
    const { error: upErr } = await this.db.storage
      .from(BUCKET)
      .upload(path, new Blob([audio.bytes as BlobPart], { type: "audio/wav" }), { contentType: "audio/wav", upsert: false });
    if (upErr) throw new StoreError("unavailable", "storage upload");
    try {
      return await this.insertOne<AudioObject>("audio_objects", {
        id,
        kind: audio.kind,
        bucket: BUCKET,
        path,
        bytes: audio.bytes.byteLength,
        duration_ms: Math.round(audio.durationMs),
        sample_rate: audio.sampleRate,
        expires_at: audio.expiresAt,
      });
    } catch (err) {
      // Never leave an object nobody can find, delete or expire.
      await this.db.storage.from(BUCKET).remove([path]);
      throw err;
    }
  }

  async getAudio(id: string) {
    const { data, error } = await this.db.from("audio_objects").select("*").eq("id", id).maybeSingle();
    if (error) fail(error, "audio_objects");
    if (!data) return null;
    const object = fromRow<AudioObject>(data as Row);
    const { data: blob, error: dlErr } = await this.db.storage.from(BUCKET).download(object.path);
    if (dlErr || !blob) return null;
    return { object, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }

  async exportAll(): Promise<ExportBundle> {
    const [sessions, deviceProfiles, consents, utterances, marks, notes, labRuns, labResults, latencyEvents, audioObjects] =
      await Promise.all([
        selectAll(this.db, "sessions", "started_at"),
        selectAll(this.db, "device_profiles", "created_at"),
        selectAll(this.db, "consents", "created_at"),
        selectAll(this.db, "utterances", "started_at"),
        selectAll(this.db, "marks", "created_at"),
        selectAll(this.db, "notes", "created_at"),
        selectAll(this.db, "lab_runs", "started_at"),
        selectAll(this.db, "lab_results", "created_at"),
        selectAll(this.db, "latency_events", "created_at"),
        selectAll(this.db, "audio_objects", "created_at"),
      ]);
    return {
      exportedAt: new Date().toISOString(),
      userId: this.userId,
      sessions: sessions.map((r) => fromRow<Session>(r)),
      deviceProfiles: deviceProfiles.map((r) => fromRow<DeviceProfile>(r)),
      consents: consents.map((r) => fromRow<ConsentRecord>(r)),
      utterances: utterances.map((r) => fromRow<Utterance>(r)),
      marks: marks.map((r) => fromRow<Mark>(r)),
      notes: notes.map((r) => fromRow<Note>(r)),
      labRuns: labRuns.map((r) => fromRow<LabRun>(r)),
      labResults: labResults.map((r) => fromRow<LabResult>(r)),
      latencyEvents: latencyEvents.map((r) => fromRow<LatencyEvent>(r)),
      audioObjects: audioObjects.map((r) => fromRow<AudioObject>(r)),
    };
  }

  /** Every object under the user's folder, whether or not it has an index row. */
  private async storagePaths(): Promise<string[]> {
    const paths = new Set<string>();
    const { data: indexed, error } = await this.db.from("audio_objects").select("path");
    if (error) fail(error, "audio_objects");
    for (const r of indexed as { path: string }[]) paths.add(r.path);
    for (const kind of ["recorder", "lab"]) {
      const prefix = `${this.userId}/${kind}`;
      for (let offset = 0; ; offset += PAGE) {
        const { data, error: listErr } = await this.db.storage.from(BUCKET).list(prefix, { limit: PAGE, offset });
        if (listErr) throw new StoreError("unavailable", "storage list");
        for (const f of data ?? []) if (f.id) paths.add(`${prefix}/${f.name}`);
        if (!data || data.length < PAGE) break;
      }
    }
    return [...paths];
  }

  async deleteAll(): Promise<DeleteReport> {
    // Objects first: once the index rows are gone, stray objects are harder
    // to find, and storage does not cascade from the database.
    const paths = await this.storagePaths();
    let storageObjects = 0;
    for (let i = 0; i < paths.length; i += PAGE) {
      const { data, error } = await this.db.storage.from(BUCKET).remove(paths.slice(i, i + PAGE));
      if (error) throw new StoreError("unavailable", "storage remove");
      storageObjects += data?.length ?? 0;
    }
    const { data, error } = await this.db.rpc("delete_my_data");
    if (error) fail(error, "delete_my_data");
    const authUserDeleted = this.adminStore ? await this.adminStore.deleteAuthUser(this.userId) : false;
    return { rows: data as Record<string, number>, storageObjects, authUserDeleted };
  }
}

class SupabaseAdmin implements AdminStore {
  constructor(private readonly db: SupabaseClient) {}

  async listAllLabResults() {
    return (await selectAll(this.db, "lab_results", "created_at")).map((r) => ({
      ...fromRow<LabResult>(r),
      // Pseudonymous participant id, so analysis can cluster by person.
      participant: r.user_id as string,
    }));
  }

  async expireAudio(at: Date) {
    let removed = 0;
    for (;;) {
      const { data, error } = await this.db
        .from("audio_objects")
        .select("id, path")
        .lte("expires_at", at.toISOString())
        .limit(PAGE);
      if (error) fail(error, "audio_objects");
      const rows = data as { id: string; path: string }[];
      if (rows.length === 0) return { removed };
      const { error: rmErr } = await this.db.storage.from(BUCKET).remove(rows.map((r) => r.path));
      if (rmErr) throw new StoreError("unavailable", "storage remove");
      const { error: delErr } = await this.db.from("audio_objects").delete().in("id", rows.map((r) => r.id));
      if (delErr) fail(delErr, "audio_objects");
      removed += rows.length;
      if (rows.length < PAGE) return { removed };
    }
  }

  async deleteAuthUser(userId: string) {
    const { error } = await this.db.auth.admin.deleteUser(userId);
    return !error;
  }
}

export class SupabaseStore implements DataStore {
  readonly kind = "supabase" as const;
  private readonly verifier: SupabaseClient;
  private readonly adminStore: SupabaseAdmin | null;

  constructor(
    private readonly url: string,
    private readonly publishableKey: string,
    secretKey: string | undefined,
  ) {
    this.verifier = createClient(url, publishableKey, { auth: NO_SESSION });
    this.adminStore = secretKey ? new SupabaseAdmin(createClient(url, secretKey, { auth: NO_SESSION })) : null;
  }

  async verify(token: string, opts: { strict?: boolean } = {}): Promise<AuthContext | null> {
    if (opts.strict) {
      const { data, error } = await this.verifier.auth.getUser(token);
      if (error || !data.user) return null;
      return { userId: data.user.id, accessToken: token, isAnonymous: !!data.user.is_anonymous };
    }
    // Verified locally against the project's JWKS when it uses asymmetric
    // signing keys; falls back to asking the auth server otherwise.
    const { data, error } = await this.verifier.auth.getClaims(token);
    const claims = data?.claims;
    if (error || !claims?.sub || claims.role !== "authenticated") return null;
    return { userId: claims.sub, accessToken: token, isAnonymous: !!claims.is_anonymous };
  }

  forUser(auth: AuthContext): UserStore {
    const db = createClient(this.url, this.publishableKey, {
      global: { headers: { Authorization: `Bearer ${auth.accessToken}` } },
      auth: NO_SESSION,
    });
    return new SupabaseUserStore(auth.userId, db, this.adminStore);
  }

  admin(): AdminStore | null {
    return this.adminStore;
  }
}
