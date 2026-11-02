import { after } from "next/server";
import { runAgent } from "@/lib/server/agent-pipeline";
import { HttpError, readJson, requireConsent, requireUser, route } from "@/lib/server/http";
import { logMetric } from "@/lib/server/log";
import { ndjsonResponse } from "@/lib/server/ndjson";
import { getLlm, getTts } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rate-limit";
import { AgentRequestSchema } from "@/lib/shared/moments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The moments agent: the wearer's question, with the few moments the device
 * chose as context, answered by Claude with tools over those moments. It
 * proposes reminders, events and drafts that the wearer accepts on the
 * device, and names the moments it drew on. See lib/shared/moments.ts for
 * the stream. Nothing is stored, and the log line has counts and timings.
 */
export const POST = route("agent", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  rateLimit(user.auth.userId, "agent");
  const body = await readJson(req, AgentRequestSchema);
  if (body.messages.at(-1)!.role !== "user" || !body.messages.at(-1)!.text) throw new HttpError(400, "invalid_request");

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const events = runAgent(body, { llm: getLlm(), tts: getTts() }, controller.signal);

  const counts = { tools: 0, actions: 0, cites: 0, audioEvents: 0, totalMs: null as number | null };
  let error: string | null = null;
  after(() => {
    logMetric("agent.turn", {
      replyLang: body.replyLang,
      speak: body.speak,
      moments: body.moments.length,
      messages: body.messages.length,
      aborted: controller.signal.aborted,
      error,
      ...counts,
    });
  });
  return ndjsonResponse(events, controller, (e) => {
    if (e.t === "tool" && e.state === "start") counts.tools++;
    else if (e.t === "action") counts.actions++;
    else if (e.t === "cite") counts.cites++;
    else if (e.t === "audio") counts.audioEvents++;
    else if (e.t === "error") error = e.code;
    else if (e.t === "done") counts.totalMs = e.totalMs;
  });
});
