import { z } from "zod";
import { json, readJson, requireConsent, requireUser, route } from "@/lib/server/http";
import { makeNote } from "@/lib/server/notes";
import { getEmbeddings, getLlm } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  sessionId: z.string().uuid().nullable(),
  source: z.enum(["batch", "on_demand", "mark"]),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  markId: z.string().uuid().optional(),
});

/** Makes a structured note from the recorder utterances in a time window. */
export const POST = route("notes.extract", async (req) => {
  const user = await requireUser(req);
  await requireConsent(user);
  const { store, auth } = user;
  rateLimit(auth.userId, "notes");
  const body = await readJson(req, Body);
  const note = await makeNote(store, getLlm(), getEmbeddings(), { ...body, signal: req.signal });
  return json(note, 201);
});
