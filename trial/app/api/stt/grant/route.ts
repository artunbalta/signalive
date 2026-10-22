import { z } from "zod";
import * as env from "@/lib/server/env";
import { HttpError, json, readJson, requireConsent, requireUser, route } from "@/lib/server/http";
import { getStt } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({ language: z.enum(["en", "tr"]) });

/**
 * Short lived credentials for streaming audio from the browser straight to
 * the recognizer. The API key itself never leaves the server.
 */
export const POST = route("stt.grant", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  const { auth } = user;
  rateLimit(auth.userId, "grant");
  const { language } = await readJson(req, Body);
  const stt = getStt();
  if (!env.stt.streaming || !stt.createBrowserStreamGrant || !stt.capabilities.streamingLanguages.includes(language)) {
    throw new HttpError(409, "streaming_unavailable");
  }
  return json(await stt.createBrowserStreamGrant({ language }));
});
