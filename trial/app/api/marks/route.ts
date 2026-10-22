import { z } from "zod";
import { json, readJson, requireUser, route } from "@/lib/server/http";
import { MARK_WINDOW_MS } from "@/lib/shared/constants";

export const dynamic = "force-dynamic";

const Body = z.object({ sessionId: z.string().uuid(), label: z.string().max(120).optional() });

/** "Mark this moment": tags the last 60 seconds. */
export const POST = route("marks", async (req) => {
  const { store } = await requireUser(req);
  const { sessionId, label } = await readJson(req, Body);
  const end = new Date();
  const mark = await store.insertMark({
    sessionId,
    startAt: new Date(end.getTime() - MARK_WINDOW_MS).toISOString(),
    endAt: end.toISOString(),
    label: label ?? null,
    noteId: null,
  });
  return json(mark, 201);
});
