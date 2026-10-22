import { json, requireUser, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route("utterances", async (req) => {
  const { store } = await requireUser(req);
  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  return json(
    await store.listUtterances({
      sessionId: url.searchParams.get("sessionId") ?? undefined,
      source: source === "recorder" || source === "assistant" ? source : undefined,
      limit: Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200))),
    }),
  );
});
