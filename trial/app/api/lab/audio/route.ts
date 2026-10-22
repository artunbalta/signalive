import { z } from "zod";
import * as env from "@/lib/server/env";
import { HttpError, json, readAudioFile, requireUser, route } from "@/lib/server/http";
import { decodeWav } from "@/lib/shared/audio/wav";
import { MAX_LAB_TAKE_MS } from "@/lib/shared/constants";

export const dynamic = "force-dynamic";

const Meta = z.object({ runId: z.string().uuid() });

/**
 * Keeps one raw lab take, at its original sample rate, for reproducibility.
 * Only for runs started with audio storage and a granted lab audio consent;
 * the recording expires after the lab retention period.
 */
export const POST = route("lab.audio", async (req) => {
  const { store } = await requireUser(req);
  const form = await req.formData();
  const { runId } = Meta.parse(JSON.parse(String(form.get("meta") ?? "{}")));
  const run = await store.getLabRun(runId);
  if (!run) throw new HttpError(404, "not_found");
  if (!run.storeAudio || !(await store.currentConsents()).lab_audio?.granted) throw new HttpError(403, "consent_required");
  const data = await readAudioFile(form);
  let wav;
  try {
    wav = decodeWav(data);
  } catch {
    throw new HttpError(400, "audio_invalid");
  }
  if (wav.durationMs > MAX_LAB_TAKE_MS + 1000) throw new HttpError(413, "audio_too_large");
  const obj = await store.putAudio({
    kind: "lab",
    bytes: data,
    durationMs: wav.durationMs,
    sampleRate: wav.sampleRate,
    expiresAt: new Date(Date.now() + env.retention.labAudioDays * 86_400_000).toISOString(),
  });
  return json({ audioObjectId: obj.id }, 201);
});
