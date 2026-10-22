import { json, requireUser, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route("notes.list", async (req) => {
  const { store } = await requireUser(req);
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const before = url.searchParams.get("before") ?? undefined;
  return json(await store.listNotes({ limit, before }));
});
