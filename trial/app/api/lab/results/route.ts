import { HttpError, json, requireUser, route } from "@/lib/server/http";
import { labResultsCsv } from "@/lib/shared/csv";

export const dynamic = "force-dynamic";

/** The caller's lab results, as JSON or as CSV. */
export const GET = route("lab.results", async (req) => {
  const { store } = await requireUser(req);
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId") ?? undefined;
  const rows = await store.listLabResults({ runId });
  if (url.searchParams.get("format") !== "csv") return json(rows);
  const runs = new Map((await store.listLabRuns()).map((r) => [r.id, r]));
  return new Response(labResultsCsv(rows, runs), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="signalive-lab-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

/** Removes one take (the user redid the phrase). */
export const DELETE = route("lab.results", async (req) => {
  const { store } = await requireUser(req);
  const takeId = new URL(req.url).searchParams.get("takeId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(takeId)) throw new HttpError(400, "invalid_id");
  return json({ removed: await store.deleteLabTake(takeId) });
});
