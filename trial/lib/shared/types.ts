/**
 * Domain types shared by the browser and the server. Nothing in here may import
 * from a server-only or browser-only module.
 */

export const LANGS = ["en", "tr"] as const;
export type Lang = (typeof LANGS)[number];
/** Speech language setting. "auto" means detect per utterance. */
export type SpeechLang = Lang | "auto";

export const VOICE_STYLES = ["normal", "whisper"] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];

export const ENVIRONMENTS = ["quiet_room", "street", "cafe", "wind_outdoors", "vehicle"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
/** Everything except a quiet room counts as a noisy condition for the headline number. */
export const NOISY_ENVIRONMENTS: readonly Environment[] = ["street", "cafe", "wind_outdoors", "vehicle"];

/**
 * Lab processing chains. All but browser_default are computed offline from one
 * raw recording, so they compare the same utterance. browser_default needs a
 * second, simultaneous capture with the browser's processing switched on.
 */
export const CHAINS = ["browser_default", "raw", "raw_rnnoise", "raw_hpf_gate"] as const;
export type ChainId = (typeof CHAINS)[number];

export const STT_PROVIDERS = ["deepgram", "openai", "groq", "mock"] as const;
export type SttProviderId = (typeof STT_PROVIDERS)[number];
export const TTS_PROVIDERS = ["openai", "elevenlabs", "mock"] as const;
export type TtsProviderId = (typeof TTS_PROVIDERS)[number];
export const LLM_PROVIDERS = ["anthropic", "mock"] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];
export const EMBEDDING_PROVIDERS = ["openai", "voyage", "mock"] as const;
export type EmbeddingProviderId = (typeof EMBEDDING_PROVIDERS)[number];

/** Every stored embedding has exactly this many dimensions (see the migration). */
export const EMBEDDING_DIMS = 1024;

export type InputMode = "ptt" | "vad";
export type SttMode = "stream" | "batch";

/** What the browser told us about the capture device, plus what we measured. */
export interface DeviceProfileInput {
  sessionId: string;
  inputLabel: string;
  outputLabel: string | null;
  trackSampleRate: number | null;
  contextSampleRate: number | null;
  channelCount: number | null;
  browser: string;
  os: string;
  isMobile: boolean;
  bluetoothSuspected: boolean;
  handsFreeSuspected: boolean;
  /** Highest frequency carrying signal during the mic check, in Hz. */
  effectiveBandwidthHz: number | null;
  rmsDbfs: number | null;
  peakDbfs: number | null;
  noiseFloorDbfs: number | null;
  /** Share of energy below 200 Hz during the wind test, 0..1. */
  windLowFreqRatio: number | null;
  outputSelectable: boolean;
  /** Which media session actions this device actually delivered. */
  mediaKeys: Partial<Record<MediaKeyAction, MediaKeyStatus>>;
  /** Free form measurements that are not worth a column yet. */
  extra?: Record<string, unknown>;
}

export const MEDIA_KEY_ACTIONS = ["play", "pause", "nexttrack", "previoustrack"] as const;
export type MediaKeyAction = (typeof MEDIA_KEY_ACTIONS)[number];
export interface MediaKeyStatus {
  /** setActionHandler accepted the handler without throwing. */
  bound: boolean;
  /** Number of times the action fired this session. */
  fired: number;
  lastFiredAt: string | null;
}

export interface DeviceProfile extends DeviceProfileInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export const CONSENT_KINDS = ["terms", "raw_audio_retention", "lab_audio"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export interface ConsentRecord {
  id: string;
  kind: ConsentKind;
  version: string;
  granted: boolean;
  details: Record<string, unknown>;
  createdAt: string;
}

export type UtteranceSource = "recorder" | "assistant";
export type UtteranceRole = "user" | "assistant";

export interface Utterance {
  id: string;
  sessionId: string;
  source: UtteranceSource;
  role: UtteranceRole;
  text: string;
  language: Lang | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  sttProvider: string | null;
  sttModel: string | null;
  confidence: number | null;
  audioObjectId: string | null;
  createdAt: string;
}

export interface Mark {
  id: string;
  sessionId: string;
  startAt: string;
  endAt: string;
  label: string | null;
  noteId: string | null;
  createdAt: string;
}

/** The structured notes the LLM produces. Validated with lib/shared/notes.ts. */
export interface NoteContent {
  title: string;
  summary: string;
  action_items: string[];
  topics: string[];
  people_mentioned: string[];
  language: Lang;
}

export type NoteSource = "batch" | "on_demand" | "mark";

export interface Note extends NoteContent {
  id: string;
  sessionId: string | null;
  source: NoteSource;
  periodStart: string | null;
  periodEnd: string | null;
  utteranceIds: string[];
  model: string;
  createdAt: string;
}

export interface NoteSearchHit {
  note: Note;
  /** Reciprocal rank fusion score, higher is better. */
  score: number;
  textRank: number | null;
  semanticSimilarity: number | null;
}

export type SearchMode = "text" | "semantic" | "hybrid";

export interface LabRun {
  id: string;
  sessionId: string | null;
  deviceProfileId: string | null;
  deviceLabel: string;
  language: Lang;
  voiceStyle: VoiceStyle;
  environment: Environment;
  chains: ChainId[];
  providers: SttProviderId[];
  phraseSetVersion: string;
  storeAudio: boolean;
  dualCapture: boolean;
  startedAt: string;
  completedAt: string | null;
}

export interface LabResult {
  id: string;
  runId: string;
  takeId: string;
  phraseId: string;
  language: Lang;
  voiceStyle: VoiceStyle;
  environment: Environment;
  deviceLabel: string;
  chain: ChainId;
  provider: SttProviderId;
  model: string;
  reference: string;
  hypothesis: string;
  refWords: number;
  refChars: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  charErrors: number;
  wer: number | null;
  cer: number | null;
  sttLatencyMs: number | null;
  audioMs: number;
  rmsDbfs: number | null;
  snrDbEstimate: number | null;
  lowFreqRatio: number | null;
  audioObjectId: string | null;
  error: string | null;
  createdAt: string;
}

/** One assistant exchange, all stage times in ms after capture end. */
export interface LatencyEventInput {
  sessionId: string | null;
  turnId: string;
  kind: "turn" | "onboarding";
  inputMode: InputMode;
  whisper: boolean;
  language: Lang | null;
  sttProvider: string | null;
  sttMode: SttMode | null;
  llmModel: string | null;
  ttsProvider: string | null;
  /** Capture end minus the last frame the VAD judged as speech. */
  endpointingMs: number | null;
  sttFinalMs: number | null;
  llmFirstTokenMs: number | null;
  firstSentenceMs: number | null;
  ttsFirstAudioMs: number | null;
  playbackStartMs: number | null;
  /** For kind "onboarding": landing page to first reply audio. */
  sinceLandingMs: number | null;
  bargeIn: boolean;
  errorCode: string | null;
}

export interface LatencyEvent extends LatencyEventInput {
  id: string;
  createdAt: string;
}

export type AudioObjectKind = "recorder" | "lab";

export interface AudioObject {
  id: string;
  kind: AudioObjectKind;
  path: string;
  bytes: number;
  durationMs: number;
  sampleRate: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  uiLang: Lang;
  speechLang: SpeechLang;
  browser: string;
  os: string;
  startedAt: string;
  endedAt: string | null;
}

/** Shape of the JSON export. Every table the user owns appears here. */
export interface ExportBundle {
  exportedAt: string;
  userId: string;
  sessions: Session[];
  deviceProfiles: DeviceProfile[];
  consents: ConsentRecord[];
  utterances: Utterance[];
  marks: Mark[];
  notes: Note[];
  labRuns: LabRun[];
  labResults: LabResult[];
  latencyEvents: LatencyEvent[];
  audioObjects: AudioObject[];
}

export interface DeleteReport {
  rows: Record<string, number>;
  storageObjects: number;
  authUserDeleted: boolean;
}

/** Public, non-secret runtime configuration the browser needs. */
export interface PublicConfig {
  dataStore: "supabase" | "memory";
  mockProviders: string[];
  stt: { provider: SttProviderId; model: string; streaming: boolean; streamingLanguages: SpeechLang[] };
  labSttProviders: SttProviderId[];
  llm: { provider: LlmProviderId; model: string };
  tts: { provider: TtsProviderId; model: string; sampleRate: number };
  embeddings: { provider: EmbeddingProviderId; model: string };
  rawAudioRetentionDays: number;
  phraseSetVersion: string;
  consentVersion: string;
  labAudioRetentionDays: number;
  /** Present when the data store is Supabase; both values are public by design. */
  supabase: { url: string; publishableKey: string } | null;
}
