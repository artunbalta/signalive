import { timingSafeEqual } from "node:crypto";
import * as env from "@/lib/server/env";
import { json, route } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
import { labResultsCsv } from "@/lib/shared/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const token = env.adminToken;
  const given = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!token || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

/**
 * Every participant's lab results, for the research team: the numbers the
 * trial exists to collect. Participants appear as their pseudonymous user id.
 * Lab transcripts are readings of the fixed phrases, not private speech.
 * Requires ADMIN_API_TOKEN and the Supabase secret key.
 */
export const GET = route("admin.lab-results", async (req) => {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const admin = getStore().admin();
  if (!admin) return json({ error: "secret_key_missing" }, 503);
  const rows = await admin.listAllLabResults();
  if (new URL(req.url).searchParams.get("format") === "json") return json(rows);
  return new Response(labResultsCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="signalive-lab-all-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
