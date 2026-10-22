import "server-only";
import type {
  EmbeddingProviderId,
  LlmProviderId,
  SttProviderId,
  TtsProviderId,
} from "@/lib/shared/types";

/**
 * Every environment variable the server reads, in one place. Secrets stay in
 * this module's callers on the server; only lib/server/config.ts decides what
 * is safe to hand to the browser, and it never includes a key.
 *
 * Provider selection: an explicit *_PROVIDER variable wins. Without one, the
 * first provider whose key is present is used, and with no key at all the
 * mock provider is used in development. In production a mock provider or the
 * in-memory store is a configuration error unless explicitly allowed, so a
 * missing key can never quietly turn a deployment into a demo.
 */

const read = (name: string): string | undefined => {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
};

const flag = (name: string): boolean => /^(1|true|yes|on)$/i.test(read(name) ?? "");

const int = (name: string, fallback: number): number => {
  const v = Number(read(name));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};

export const isProduction = process.env.NODE_ENV === "production";

export const keys = {
  anthropic: read("ANTHROPIC_API_KEY"),
  openai: read("OPENAI_API_KEY"),
  deepgram: read("DEEPGRAM_API_KEY"),
  groq: read("GROQ_API_KEY"),
  elevenlabs: read("ELEVENLABS_API_KEY"),
  voyage: read("VOYAGE_API_KEY"),
};

const hasKey: Record<string, boolean> = {
  anthropic: !!keys.anthropic,
  openai: !!keys.openai,
  deepgram: !!keys.deepgram,
  groq: !!keys.groq,
  elevenlabs: !!keys.elevenlabs,
  voyage: !!keys.voyage,
  mock: true,
};

export const configProblems: string[] = [];

function pick<T extends string>(
  kind: string,
  explicit: string | undefined,
  allowed: readonly T[],
  preference: readonly T[],
): T {
  if (explicit) {
    if (!(allowed as readonly string[]).includes(explicit)) {
      configProblems.push(`${kind}: unknown provider "${explicit}"`);
      return "mock" as T;
    }
    if (!hasKey[explicit]) configProblems.push(`${kind}: ${explicit} selected but its API key is not set`);
    return explicit as T;
  }
  return preference.find((p) => hasKey[p] && p !== "mock") ?? ("mock" as T);
}

export const allowMockProviders = !isProduction || flag("ALLOW_MOCK_PROVIDERS");
export const allowMemoryStore = !isProduction || flag("ALLOW_MEMORY_STORE");

export const stt = {
  provider: pick<SttProviderId>("STT", read("STT_PROVIDER"), ["deepgram", "openai", "groq", "mock"], [
    "deepgram", "openai", "groq",
  ]),
  /** Browser streaming needs a provider with short lived browser credentials. */
  streaming: read("STT_STREAMING") !== "off",
  deepgramModel: read("DEEPGRAM_MODEL") ?? "nova-3",
  // gpt-4o-transcribe and whisper-1 shut down on 2027-02-26.
  openaiModel: read("OPENAI_STT_MODEL") ?? "gpt-transcribe",
  groqModel: read("GROQ_STT_MODEL") ?? "whisper-large-v3-turbo",
};

const labList = (read("LAB_STT_PROVIDERS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const labSttProviders: SttProviderId[] = (
  labList.length
    ? labList.filter((p): p is SttProviderId => ["deepgram", "openai", "groq", "mock"].includes(p))
    : (["deepgram", "openai", "groq"] as SttProviderId[]).filter((p) => hasKey[p])
).slice(0, 3);
if (labSttProviders.length === 0) labSttProviders.push("mock");
for (const p of labSttProviders) {
  if (!hasKey[p]) configProblems.push(`LAB_STT_PROVIDERS: ${p} has no API key`);
}

export type ThinkingMode = "adaptive" | "between_tools" | "disabled";

const llmModel = read("LLM_MODEL") ?? "claude-sonnet-5-5";
export const llm = {
  provider: pick<LlmProviderId>("LLM", read("LLM_PROVIDER"), ["anthropic", "mock"], ["anthropic"]),
  model: llmModel,
  /**
   * Voice replies want the first token fast. On claude-sonnet-5-5 the lowest
   * thinking setting is "between_tools" ("disabled" is rejected there); other
   * models default to adaptive thinking and rely on low effort.
   */
  thinking: (read("LLM_THINKING") as ThinkingMode | undefined) ??
    (llmModel === "claude-sonnet-5-5" ? "between_tools" : "adaptive"),
  effort: (read("LLM_EFFORT") ?? "low") as "low" | "medium" | "high",
  /** Notes extraction is not latency bound; it may use a different model. */
  notesModel: read("LLM_NOTES_MODEL") ?? llmModel,
  /** Server side refusal fallback ("default" routes by refusal category). */
  fallbacks: read("LLM_FALLBACKS") ?? "default",
};

// ElevenLabs premade voices expire on 2026-12-31, so there is no built in
// default voice: without a configured voice id ElevenLabs is not selectable.
const elevenlabsVoice = read("ELEVENLABS_VOICE_ID");
const elevenlabsVoiceEn = read("ELEVENLABS_VOICE_EN") ?? elevenlabsVoice;
const elevenlabsVoiceTr = read("ELEVENLABS_VOICE_TR") ?? elevenlabsVoice;
hasKey.elevenlabs = !!keys.elevenlabs && !!elevenlabsVoiceEn && !!elevenlabsVoiceTr;
if (keys.elevenlabs && !hasKey.elevenlabs) {
  configProblems.push("ElevenLabs: set ELEVENLABS_VOICE_ID (or ELEVENLABS_VOICE_EN and ELEVENLABS_VOICE_TR)");
}

export const tts = {
  // OpenAI's /v1/audio/speech models shut down on 2027-01-06, so ElevenLabs
  // is preferred when both are configured.
  provider: pick<TtsProviderId>("TTS", read("TTS_PROVIDER"), ["openai", "elevenlabs", "mock"], [
    "elevenlabs", "openai",
  ]),
  openaiModel: read("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts",
  openaiVoiceEn: read("OPENAI_TTS_VOICE_EN") ?? "marin",
  openaiVoiceTr: read("OPENAI_TTS_VOICE_TR") ?? "marin",
  elevenlabsModel: read("ELEVENLABS_MODEL") ?? "eleven_flash_v2_5",
  elevenlabsVoiceEn,
  elevenlabsVoiceTr,
};

export const embeddings = {
  provider: pick<EmbeddingProviderId>("EMBEDDINGS", read("EMBEDDINGS_PROVIDER"), ["openai", "voyage", "mock"], [
    "voyage", "openai",
  ]),
  openaiModel: read("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
  voyageModel: read("VOYAGE_MODEL") ?? "voyage-4-lite",
};

export const supabase = {
  url: read("NEXT_PUBLIC_SUPABASE_URL"),
  publishableKey: read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  /** Secret (service role) key: cron expiry and deleting the auth user only. */
  secretKey: read("SUPABASE_SECRET_KEY") ?? read("SUPABASE_SERVICE_ROLE_KEY"),
};

export const dataStore: "supabase" | "memory" =
  supabase.url && supabase.publishableKey ? "supabase" : "memory";

export const retention = {
  rawAudioDays: int("RAW_AUDIO_RETENTION_DAYS", 7),
  labAudioDays: int("LAB_AUDIO_RETENTION_DAYS", 90),
};

export const cronSecret = read("CRON_SECRET");
export const adminToken = read("ADMIN_API_TOKEN");

export const mockProviders = (
  [
    ["stt", stt.provider],
    ["llm", llm.provider],
    ["tts", tts.provider],
    ["embeddings", embeddings.provider],
    ...labSttProviders.map((p) => ["lab-stt", p] as const),
  ] as const
)
  .filter(([, p]) => p === "mock")
  .map(([k]) => k as string);

if (mockProviders.length && !allowMockProviders) {
  configProblems.push(
    `mock providers in production (${[...new Set(mockProviders)].join(", ")}): set the API keys or ALLOW_MOCK_PROVIDERS=true`,
  );
}
if (dataStore === "memory" && !allowMemoryStore) {
  configProblems.push("no Supabase configured: set NEXT_PUBLIC_SUPABASE_URL and a publishable key, or ALLOW_MEMORY_STORE=true");
}
if (!["adaptive", "between_tools", "disabled"].includes(llm.thinking)) {
  configProblems.push(`LLM_THINKING must be adaptive, between_tools or disabled`);
}
