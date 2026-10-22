"use client";

import { currentToken } from "./auth";

/**
 * The browser side of every API call. Errors arrive as a stable code that
 * components translate (messages.errors), never as server text.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

let consentLost: (() => void) | null = null;

/**
 * What to do when the server answers that this browser has not agreed to the
 * terms although the browser holds an agreement: AppShell sends the visitor
 * back to the consent screen. It happens when a development server, which
 * keeps everything in memory, restarts, or when an agreement is withdrawn.
 */
export function onConsentLost(handler: (() => void) | null) {
  consentLost = handler;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await currentToken();
  if (!token) throw new ApiError(401, "unauthenticated");
  return { Authorization: `Bearer ${token}` };
}

export interface ApiInit extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit;
}

export async function apiFetch(path: string, init: ApiInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await authHeaders())) headers.set(k, v);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, body });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network");
  }
  if (!res.ok) {
    let code = "generic";
    try {
      const data = (await res.json()) as { error?: string };
      if (typeof data.error === "string") code = data.error;
    } catch {
      // keep the generic code
    }
    if (res.status === 403 && code === "consent_required") consentLost?.();
    throw new ApiError(res.status, code);
  }
  return res;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  return (await res.json()) as T;
}

/** Maps an API or browser error code to the key of its translated message. */
export function errorKey(code: string):
  | "generic" | "unauthenticated" | "server_not_configured" | "network" | "anon_disabled" | "provider"
  | "provider_rate_limited" | "store" | "no_speech" | "audio_too_large" {
  if (code === "unauthenticated" || code === "server_not_configured" || code === "network" || code === "anon_disabled") {
    return code;
  }
  // No consent on record: the way back is the consent screen.
  if (code === "consent_required") return "unauthenticated";
  if (code === "no_speech" || code === "audio_too_large") return code;
  if (code === "provider_rate_limited") return code;
  if (code.startsWith("provider_")) return "provider";
  if (code.startsWith("store_")) return "store";
  return "generic";
}
