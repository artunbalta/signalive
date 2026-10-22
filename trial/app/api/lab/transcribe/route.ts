import { z } from "zod";
import { HttpError, json, readAudioFile, requireConsent, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { getStt } from "@/lib/server/providers";
import { ProviderError } from "@/lib/server/providers/types";
import { rateLimit } from "@/lib/server/rate-limit";
import type { NewLabResult } from "@/lib/server/store/types";
import { decodeWav } from "@/lib/shared/audio/wav";
import { phraseById } from "@/lib/shared/lab/phrases";
import { scoreTranscript } from "@/lib/shared/text/wer";
import { CHAINS, type ChainId } from "@/lib/shared/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const finite = z.number().finite().nullable();
const Meta = z.object({
  runId: z.string().uuid(),
  takeId: z.string().uuid(),
  phraseId: z.string().max(20),
  audioObjectId: z.string().uuid().nullable(),
  /** Measured on the raw take. */
  metrics: z.object({ rmsDbfs: finite, snrDbEstimate: finite, lowFreqRatio: finite }),
  /** Chains whose processing failed in the browser, recorded as errors. */
  chainErrors: z.partialRecord(z.enum(CHAINS), z.string().max(60)).default({}),
});

/**
 * Scores one lab take: every processed version (one 16 kHz WAV per chain)
 * goes to every recognizer of the run, in parallel, and each transcript is
 * scored against the phrase. A failed call is stored as a row with its error
 * code and no score, so failure rates are visible too.
 */
export const POST = route("lab.transcribe", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  const { store, auth } = user;
  rateLimit(auth.userId, "lab");
  const form = await req.formData();
  const meta = Meta.parse(JSON.parse(String(form.get("meta") ?? "{}")));
  const run = await store.getLabRun(meta.runId);
  if (!run) throw new HttpError(404, "not_found");
  const phrase = phraseById(meta.phraseId);
  if (!phrase || phrase.lang !== run.language) throw new HttpError(400, "invalid_phrase");

  const files: { chain: ChainId; data: Uint8Array; audioMs: number }[] = [];
  for (const chain of run.chains) {
    if (!form.has(`chain_${chain}`)) continue;
    const data = await readAudioFile(form, `chain_${chain}`);
    let audioMs = 0;
    try {
      audioMs = decodeWav(data).durationMs;
    } catch {
      throw new HttpError(400, "audio_invalid");
    }
    files.push({ chain, data, audioMs });
  }
  if (files.length === 0 && Object.keys(meta.chainErrors).length === 0) throw new HttpError(400, "missing_audio");

  const base = {
    runId: run.id,
    takeId: meta.takeId,
    phraseId: phrase.id,
    language: run.language,
    voiceStyle: run.voiceStyle,
    environment: run.environment,
    deviceLabel: run.deviceLabel,
    reference: phrase.text,
    refWords: 0,
    refChars: 0,
    substitutions: 0,
    deletions: 0,
    insertions: 0,
    charErrors: 0,
    rmsDbfs: meta.metrics.rmsDbfs,
    snrDbEstimate: meta.metrics.snrDbEstimate,
    lowFreqRatio: meta.metrics.lowFreqRatio,
    audioObjectId: meta.audioObjectId,
  };

  const jobs = files.flatMap((f) =>
    run.providers.map(async (provider): Promise<NewLabResult> => {
      const stt = getStt(provider);
      try {
        const r = await stt.transcribeFile(
          { data: f.data, mimeType: "audio/wav", durationMs: f.audioMs },
          // The reference goes to the mock only (see SttOptions.hint).
          { language: run.language, signal: req.signal, ...(provider === "mock" ? { hint: phrase.text } : {}) },
        );
        const s = scoreTranscript(phrase.text, r.text, run.language);
        return {
          ...base,
          chain: f.chain,
          provider,
          model: r.model,
          hypothesis: r.text,
          refWords: s.refWords,
          refChars: s.refChars,
          substitutions: s.substitutions,
          deletions: s.deletions,
          insertions: s.insertions,
          charErrors: s.charErrors,
          wer: s.wer,
          cer: s.cer,
          sttLatencyMs: Math.round(r.latencyMs),
          audioMs: Math.round(f.audioMs),
          error: null,
        };
      } catch (err) {
        return {
          ...base,
          chain: f.chain,
          provider,
          model: stt.model,
          hypothesis: "",
          wer: null,
          cer: null,
          sttLatencyMs: null,
          audioMs: Math.round(f.audioMs),
          error: err instanceof ProviderError ? `provider_${err.code}` : "server_error",
        };
      }
    }),
  );

  const failedChains: NewLabResult[] = (Object.entries(meta.chainErrors) as [ChainId, string][])
    .filter(([chain]) => run.chains.includes(chain))
    .flatMap(([chain, code]) =>
      run.providers.map((provider) => ({
        ...base,
        chain,
        provider,
        model: "",
        hypothesis: "",
        wer: null,
        cer: null,
        sttLatencyMs: null,
        audioMs: 0,
        error: `chain_${code}`.slice(0, 60),
      })),
    );

  const rows = await store.insertLabResults([...(await Promise.all(jobs)), ...failedChains]);
  logMetric("lab.take", { chains: files.length, providers: run.providers.length, failed: rows.filter((r) => r.error).length });
  return json(rows, 201);
});
