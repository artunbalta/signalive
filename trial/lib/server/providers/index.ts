import "server-only";
import * as env from "@/lib/server/env";
import type { SttProviderId } from "@/lib/shared/types";
import { AnthropicLlm } from "./anthropic";
import { DeepgramStt } from "./deepgram";
import { ElevenLabsTts } from "./elevenlabs";
import { GroqStt } from "./groq";
import { MockEmbeddings, MockLlm, MockStt, MockTts } from "./mock";
import { OpenAiEmbeddings, OpenAiStt, OpenAiTts } from "./openai";
import type { EmbeddingProvider, LlmProvider, SttProvider, TtsProvider } from "./types";
import { VoyageEmbeddings } from "./voyage";

/**
 * The only place that knows which concrete provider sits behind each
 * adapter. Instances are created lazily and reused across requests in the
 * same server process.
 */

const stt = new Map<SttProviderId, SttProvider>();

export function getStt(id: SttProviderId = env.stt.provider): SttProvider {
  let p = stt.get(id);
  if (p) return p;
  switch (id) {
    case "deepgram":
      p = env.keys.deepgram ? new DeepgramStt(env.keys.deepgram, env.stt.deepgramModel) : new MockStt();
      break;
    case "openai":
      p = env.keys.openai ? new OpenAiStt(env.keys.openai, env.stt.openaiModel) : new MockStt();
      break;
    case "groq":
      p = env.keys.groq ? new GroqStt(env.keys.groq, env.stt.groqModel) : new MockStt();
      break;
    default:
      p = new MockStt();
  }
  stt.set(id, p);
  return p;
}

let llm: LlmProvider | undefined;
export function getLlm(): LlmProvider {
  if (!llm) {
    llm =
      env.llm.provider === "anthropic" && env.keys.anthropic
        ? new AnthropicLlm({
            apiKey: env.keys.anthropic,
            model: env.llm.model,
            notesModel: env.llm.notesModel,
            thinking: env.llm.thinking,
            effort: env.llm.effort,
            fallbacks: env.llm.fallbacks,
          })
        : new MockLlm();
  }
  return llm;
}

let tts: TtsProvider | undefined;
export function getTts(): TtsProvider {
  if (!tts) {
    if (env.tts.provider === "elevenlabs" && env.keys.elevenlabs && env.tts.elevenlabsVoiceEn && env.tts.elevenlabsVoiceTr) {
      tts = new ElevenLabsTts(env.keys.elevenlabs, env.tts.elevenlabsModel, {
        en: env.tts.elevenlabsVoiceEn,
        tr: env.tts.elevenlabsVoiceTr,
      });
    } else if (env.tts.provider === "openai" && env.keys.openai) {
      tts = new OpenAiTts(env.keys.openai, env.tts.openaiModel, { en: env.tts.openaiVoiceEn, tr: env.tts.openaiVoiceTr });
    } else {
      tts = new MockTts();
    }
  }
  return tts;
}

let embeddings: EmbeddingProvider | undefined;
export function getEmbeddings(): EmbeddingProvider {
  if (!embeddings) {
    if (env.embeddings.provider === "voyage" && env.keys.voyage) {
      embeddings = new VoyageEmbeddings(env.keys.voyage, env.embeddings.voyageModel);
    } else if (env.embeddings.provider === "openai" && env.keys.openai) {
      embeddings = new OpenAiEmbeddings(env.keys.openai, env.embeddings.openaiModel);
    } else {
      embeddings = new MockEmbeddings();
    }
  }
  return embeddings;
}
