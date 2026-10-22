import { HttpError, json, requireUser, route } from "@/lib/server/http";
import { searchUserNotes } from "@/lib/server/notes-search";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export const GET = route("notes.search", async (req) => {
  const { store, auth } = await requireUser(req);
  rateLimit(auth.userId, "search");
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 300);
  const mode = url.searchParams.get("mode") ?? "hybrid";
  if (mode !== "text" && mode !== "semantic" && mode !== "hybrid") throw new HttpError(400, "invalid_mode");
  if (!q.trim()) return json([]);
  return json(await searchUserNotes(store, q, { mode, limit: 20, signal: req.signal }));
});
