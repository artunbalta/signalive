import * as env from "@/lib/server/env";
import { json, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { getStore } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily (vercel.json): deletes stored recordings past their retention date,
 * objects first, then their index rows. Vercel sends CRON_SECRET as a bearer
 * token; nothing else may run this.
 */
export const GET = route("cron.expire-audio", async (req) => {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const admin = getStore().admin();
  if (!admin) return json({ error: "secret_key_missing" }, 503);
  const { removed } = await admin.expireAudio(new Date());
  logMetric("cron.expire-audio", { removed });
  return json({ removed });
});
