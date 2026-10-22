import { z } from "zod";
import { json, readJson, requireUser, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Create = z.object({
  uiLang: z.enum(["en", "tr"]),
  speechLang: z.enum(["en", "tr", "auto"]),
  browser: z.string().max(60),
  os: z.string().max(60),
});

export const POST = route("session.create", async (req) => {
  const { store } = await requireUser(req);
  const session = await store.createSession(await readJson(req, Create));
  return json(session, 201);
});

const End = z.object({ id: z.string().uuid() });

export const PATCH = route("session.end", async (req) => {
  const { store } = await requireUser(req);
  const { id } = await readJson(req, End);
  await store.endSession(id);
  return json({ ok: true });
});
