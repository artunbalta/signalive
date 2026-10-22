import type {
  AudioObject,
  AudioObjectKind,
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
  Lang,
  Mark,
  Note,
  NoteContent,
  NoteSearchHit,
  NoteSource,
  Session,
  SpeechLang,
  Utterance,
} from "@/lib/shared/types";

export interface AuthContext {
  userId: string;
  /** The user's own access token; Supabase queries run with it so RLS applies. */
  accessToken: string;
  isAnonymous: boolean;
}

export type NewSession = Pick<Session, "uiLang" | "speechLang" | "browser" | "os">;
export type NewUtterance = Omit<Utterance, "id" | "createdAt">;
export type NewMark = Omit<Mark, "id" | "createdAt">;
export interface NewNote extends NoteContent {
  sessionId: string | null;
  source: NoteSource;
  periodStart: string | null;
  periodEnd: string | null;
  utteranceIds: string[];
  model: string;
}
export type NewLabRun = Omit<LabRun, "id" | "startedAt" | "completedAt">;
export type NewLabResult = Omit<LabResult, "id" | "createdAt">;
export interface NewAudio {
  kind: AudioObjectKind;
  bytes: Uint8Array;
  durationMs: number;
  sampleRate: number;
  expiresAt: string | null;
}

export interface NoteQuery {
  /** Built by buildTsQuery; null skips the text half of the search. */
  tsquery: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  limit: number;
}

/** All reads and writes for one signed in user. Every method is owner scoped. */
export interface UserStore {
  readonly userId: string;

  createSession(input: NewSession): Promise<Session>;
  endSession(id: string): Promise<void>;
  sessionLanguages(id: string): Promise<{ uiLang: Lang; speechLang: SpeechLang } | null>;

  saveDeviceProfile(input: DeviceProfileInput, id?: string): Promise<DeviceProfile>;
  getDeviceProfile(id: string): Promise<DeviceProfile | null>;

  recordConsent(kind: ConsentKind, version: string, granted: boolean, details?: Record<string, unknown>): Promise<ConsentRecord>;
  /** Most recent record per kind. */
  currentConsents(): Promise<Partial<Record<ConsentKind, ConsentRecord>>>;

  insertUtterances(rows: NewUtterance[]): Promise<Utterance[]>;
  listUtterances(opts: { sessionId?: string; from?: string; to?: string; source?: Utterance["source"]; limit?: number }): Promise<Utterance[]>;

  insertMark(mark: NewMark): Promise<Mark>;
  attachNoteToMark(markId: string, noteId: string): Promise<void>;

  insertNote(note: NewNote, embedding: { model: string; vector: number[] } | null): Promise<Note>;
  listNotes(opts: { limit: number; before?: string }): Promise<Note[]>;
  getNotes(ids: string[]): Promise<Note[]>;
  searchNotes(q: NoteQuery): Promise<NoteSearchHit[]>;

  createLabRun(run: NewLabRun): Promise<LabRun>;
  getLabRun(id: string): Promise<LabRun | null>;
  completeLabRun(id: string): Promise<void>;
  listLabRuns(): Promise<LabRun[]>;
  insertLabResults(rows: NewLabResult[]): Promise<LabResult[]>;
  listLabResults(opts?: { runId?: string }): Promise<LabResult[]>;
  /** Removes one take's rows (a redo replaces a misread take). Returns rows removed. */
  deleteLabTake(takeId: string): Promise<number>;

  insertLatencyEvent(e: LatencyEventInput): Promise<LatencyEvent>;
  listLatencyEvents(limit: number): Promise<LatencyEvent[]>;

  putAudio(audio: NewAudio): Promise<AudioObject>;
  getAudio(id: string): Promise<{ object: AudioObject; bytes: Uint8Array } | null>;

  exportAll(): Promise<ExportBundle>;
  /** Removes stored objects first, then every row, then (if possible) the auth user. */
  deleteAll(): Promise<DeleteReport>;
}

/** Service level operations. Only available with a secret key (or in memory). */
export interface AdminStore {
  listAllLabResults(): Promise<LabResult[]>;
  expireAudio(now: Date): Promise<{ removed: number }>;
  deleteAuthUser(userId: string): Promise<boolean>;
}

export interface DataStore {
  readonly kind: "supabase" | "memory";
  /**
   * Verifies a bearer token. strict asks the auth server (catches signed out
   * and deleted users); otherwise a local signature check is enough.
   */
  verify(token: string, opts?: { strict?: boolean }): Promise<AuthContext | null>;
  forUser(auth: AuthContext): UserStore;
  admin(): AdminStore | null;
}

export class StoreError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "conflict" | "unavailable" | "invalid",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "StoreError";
  }
}
