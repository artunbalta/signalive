import "server-only";
import * as env from "@/lib/server/env";
import { getEmbeddings, getLlm, getStt, getTts } from "@/lib/server/providers";
import { CONSENT_VERSION, PHRASE_SET_VERSION } from "@/lib/shared/constants";
import type { PublicConfig } from "@/lib/shared/types";

/** The browser's view of the server configuration. Never contains a key. */
export function publicConfig(): PublicConfig & { problems: string[] } {
  const stt = getStt();
  const browserStreaming = env.stt.streaming && stt.capabilities.browserStreaming;
  return {
    dataStore: env.dataStore,
    mockProviders: [...new Set(env.mockProviders)],
    stt: {
      provider: stt.id,
      model: stt.model,
      streaming: browserStreaming,
      streamingLanguages: browserStreaming ? stt.capabilities.streamingLanguages : [],
    },
    labSttProviders: env.labSttProviders,
    llm: { provider: getLlm().id, model: getLlm().model },
    tts: { provider: getTts().id, model: getTts().model, sampleRate: getTts().sampleRate },
    embeddings: { provider: getEmbeddings().id, model: getEmbeddings().model },
    rawAudioRetentionDays: env.retention.rawAudioDays,
    labAudioRetentionDays: env.retention.labAudioDays,
    supabase:
      env.dataStore === "supabase" && env.supabase.url && env.supabase.publishableKey
        ? { url: env.supabase.url, publishableKey: env.supabase.publishableKey }
        : null,
    phraseSetVersion: PHRASE_SET_VERSION,
    consentVersion: CONSENT_VERSION,
    // Only the kind of problem, so an operator can see why the app refuses to
    // run; nothing secret is in these strings.
    problems: env.configProblems,
  };
}
