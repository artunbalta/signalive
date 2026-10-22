import { z } from "zod";
import { json, readJson, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const ms = z.number().min(0).max(600_000).nullable();

const Body = z.object({
  sessionId: z.string().uuid().nullable(),
  turnId: z.string().uuid(),
  kind: z.enum(["turn", "onboarding"]),
  inputMode: z.enum(["ptt", "vad"]),
  whisper: z.boolean(),
  language: z.enum(["en", "tr"]).nullable(),
  sttProvider: z.string().max(40).nullable(),
  sttMode: z.enum(["stream", "batch"]).nullable(),
  llmModel: z.string().max(80).nullable(),
  ttsProvider: z.string().max(40).nullable(),
  endpointingMs: ms,
  sttFinalMs: ms,
  llmFirstTokenMs: ms,
  firstSentenceMs: ms,
  ttsFirstAudioMs: ms,
  playbackStartMs: ms,
  sinceLandingMs: z.number().min(0).max(86_400_000).nullable(),
  bargeIn: z.boolean(),
  errorCode: z.string().max(60).nullable(),
});

const round = (v: number | null) => (v === null ? null : Math.round(v));

/** Per exchange timings, measured in the browser. Metrics only, no text. */
export const POST = route("latency", async (req) => {
  const { store } = await requireUser(req);
  const b = await readJson(req, Body);
  const event = await store.insertLatencyEvent({
    ...b,
    endpointingMs: round(b.endpointingMs),
    sttFinalMs: round(b.sttFinalMs),
    llmFirstTokenMs: round(b.llmFirstTokenMs),
    firstSentenceMs: round(b.firstSentenceMs),
    ttsFirstAudioMs: round(b.ttsFirstAudioMs),
    playbackStartMs: round(b.playbackStartMs),
    sinceLandingMs: round(b.sinceLandingMs),
  });
  logMetric("latency.event", {
    kind: b.kind,
    mode: b.inputMode,
    stt: b.sttMode,
    playbackStartMs: b.playbackStartMs,
    sttFinalMs: b.sttFinalMs,
    llmFirstTokenMs: b.llmFirstTokenMs,
  });
  return json(event, 201);
});

export const GET = route("latency", async (req) => {
  const { store } = await requireUser(req);
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 20)));
  return json(await store.listLatencyEvents(limit));
});
