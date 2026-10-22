import { z } from "zod";
import { json, readJson, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ confirm: z.literal("delete-everything") });

/**
 * Deletes every stored object and every row the caller owns, then the auth
 * user itself when the server has the secret key. The token is checked with
 * the auth server (strict), not only by signature.
 */
export const POST = route("delete-all", async (req) => {
  const { store } = await requireUser(req, { strict: true });
  await readJson(req, Body);
  const report = await store.deleteAll();
  logMetric("delete-all", {
    rows: Object.values(report.rows).reduce((a, b) => a + b, 0),
    objects: report.storageObjects,
    authUserDeleted: report.authUserDeleted,
  });
  return json(report);
});
