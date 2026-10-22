import { json, requireUser, route } from "@/lib/server/http";
import { exportToMarkdown } from "@/lib/shared/export-md";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Everything the caller owns, as JSON (complete) or Markdown (readable). */
export const GET = route("export", async (req) => {
  const { store } = await requireUser(req);
  const format = new URL(req.url).searchParams.get("format") === "md" ? "md" : "json";
  const bundle = await store.exportAll();
  const stamp = bundle.exportedAt.slice(0, 10);
  if (format === "md") {
    return new Response(exportToMarkdown(bundle), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="signalive-${stamp}.md"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return json(bundle, 200, { "Content-Disposition": `attachment; filename="signalive-${stamp}.json"` });
});
