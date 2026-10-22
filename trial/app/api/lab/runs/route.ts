import { z } from "zod";
import * as env from "@/lib/server/env";
import { HttpError, json, readJson, requireConsent, requireUser, route } from "@/lib/server/http";
import { PHRASE_SET_VERSION } from "@/lib/shared/constants";
import { CHAINS, ENVIRONMENTS, STT_PROVIDERS, VOICE_STYLES } from "@/lib/shared/types";

export const dynamic = "force-dynamic";

const Create = z.object({
  sessionId: z.string().uuid().nullable(),
  deviceProfileId: z.string().uuid().nullable(),
  deviceLabel: z.string().max(200),
  language: z.enum(["en", "tr"]),
  voiceStyle: z.enum(VOICE_STYLES),
  environment: z.enum(ENVIRONMENTS),
  chains: z.array(z.enum(CHAINS)).min(1).max(CHAINS.length),
  providers: z.array(z.enum(STT_PROVIDERS)).min(1).max(3),
  storeAudio: z.boolean(),
  dualCapture: z.boolean(),
});

/** Starts a lab run: one condition, one device, a set of chains and recognizers. */
export const POST = route("lab.runs", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  const { store } = user;
  const b = await readJson(req, Create);
  // Only recognizers this server is configured for; the browser cannot add one.
  const providers = b.providers.filter((p) => env.labSttProviders.includes(p));
  if (providers.length === 0) throw new HttpError(400, "no_recognizers");
  const chains = b.dualCapture ? b.chains : b.chains.filter((c) => c !== "browser_default");
  if (chains.length === 0) throw new HttpError(400, "no_chains");
  if (b.storeAudio && !(await store.currentConsents()).lab_audio?.granted) throw new HttpError(400, "consent_required");
  const run = await store.createLabRun({ ...b, providers, chains, phraseSetVersion: PHRASE_SET_VERSION });
  return json(run, 201);
});

export const PATCH = route("lab.runs", async (req) => {
  const { store } = await requireUser(req);
  const { id } = await readJson(req, z.object({ id: z.string().uuid() }));
  await store.completeLabRun(id);
  return json({ ok: true });
});

export const GET = route("lab.runs", async (req) => {
  const { store } = await requireUser(req);
  return json(await store.listLabRuns());
});
