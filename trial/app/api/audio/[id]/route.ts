import { HttpError, requireUser, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Streams one of the caller's stored recordings. */
export const GET = route("audio", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { store } = await requireUser(req);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "invalid_id");
  const found = await store.getAudio(id);
  if (!found) throw new HttpError(404, "not_found");
  return new Response(found.bytes as BodyInit, {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, no-store" },
  });
});
