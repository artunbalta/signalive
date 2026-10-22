import { z } from "zod";
import * as env from "@/lib/server/env";
import { json, readJson, requireUser, route } from "@/lib/server/http";
import { CONSENT_KINDS } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(CONSENT_KINDS),
  version: z.string().min(1).max(40),
  granted: z.boolean(),
});

/** Consents are an append only log; withdrawing records granted = false. */
export const POST = route("consent", async (req) => {
  const { store } = await requireUser(req);
  const body = await readJson(req, Body);
  const retentionDays =
    body.kind === "raw_audio_retention" ? env.retention.rawAudioDays
    : body.kind === "lab_audio" ? env.retention.labAudioDays
    : null;
  const record = await store.recordConsent(body.kind, body.version, body.granted, retentionDays ? { retentionDays } : {});
  return json(record, 201);
});

export const GET = route("consent", async (req) => {
  const { store } = await requireUser(req);
  return json(await store.currentConsents());
});
