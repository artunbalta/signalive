import "server-only";
import { ZodError, type z } from "zod";
import * as env from "@/lib/server/env";
import { logError } from "@/lib/server/log";
import { ProviderError } from "@/lib/server/providers/types";
import { getStore } from "@/lib/server/store";
import { StoreError, type AuthContext, type UserStore } from "@/lib/server/store/types";

/**
 * Route handler plumbing. Errors leave the server as a stable code plus an
 * HTTP status; the browser maps codes to translated explanations. Provider
 * and database messages are never forwarded.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });

export function errorResponse(err: unknown, route: string): Response {
  if (err instanceof HttpError) return json({ error: err.code }, err.status);
  if (err instanceof ZodError) return json({ error: "invalid_request" }, 400);
  if (err instanceof StoreError) {
    const status = { not_found: 404, forbidden: 403, conflict: 409, invalid: 400, unavailable: 503 }[err.code];
    if (status >= 500) logError(`${route}.store`, err);
    return json({ error: `store_${err.code}` }, status);
  }
  if (err instanceof ProviderError) {
    logError(`${route}.provider`, err, { provider: err.provider, status: err.status });
    return json({ error: `provider_${err.code}`, provider: err.provider }, 502);
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return json({ error: "aborted" }, 499);
  }
  logError(`${route}.unhandled`, err);
  return json({ error: "server_error" }, 500);
}

export interface RequestUser {
  auth: AuthContext;
  store: UserStore;
}

/** Resolves the bearer token to a user and a store scoped to that user. */
export async function requireUser(req: Request, opts: { strict?: boolean } = {}): Promise<RequestUser> {
  if (env.configProblems.length && env.isProduction) throw new HttpError(503, "server_not_configured");
  const header = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token) throw new HttpError(401, "unauthenticated");
  const store = getStore();
  const auth = await store.verify(token, opts);
  if (!auth) throw new HttpError(401, "unauthenticated");
  return { auth, store: store.forUser(auth) };
}

/**
 * Routes that process audio or call paid providers also check, on the
 * server, that the user agreed to the trial terms (the browser enforces it
 * too). Cached per user for a few minutes so a voice turn does not pay a
 * database round trip for it.
 */
const consented = new Map<string, number>();
const CONSENT_TTL_MS = 5 * 60_000;

export async function requireConsent({ auth, store }: RequestUser): Promise<void> {
  const until = consented.get(auth.userId);
  if (until && until > Date.now()) return;
  const terms = (await store.currentConsents()).terms;
  if (!terms?.granted) throw new HttpError(403, "consent_required");
  consented.set(auth.userId, Date.now() + CONSENT_TTL_MS);
  if (consented.size > 50_000) consented.clear();
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  return schema.parse(body);
}

/** Wraps a handler so every failure becomes a coded error response. */
export function route<A extends unknown[]>(name: string, handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      return await handler(req, ...rest);
    } catch (err) {
      return errorResponse(err, name);
    }
  };
}

/** Largest audio upload accepted; Vercel functions cap request bodies at 4.5 MB. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export async function readAudioFile(form: FormData, field = "audio"): Promise<Uint8Array> {
  const file = form.get(field);
  if (!(file instanceof Blob)) throw new HttpError(400, "missing_audio");
  if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, "audio_too_large");
  if (file.size < 44) throw new HttpError(400, "audio_empty");
  return new Uint8Array(await file.arrayBuffer());
}
