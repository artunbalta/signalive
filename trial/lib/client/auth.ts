"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicConfig } from "@/lib/shared/types";
import { clearPrefs, getPref, setPrefs } from "./prefs";

/**
 * Who the browser is, from the server's point of view.
 *
 * With Supabase: an anonymous Supabase user, created only after the consent
 * screen (never on page load), with the session kept by supabase-js in
 * localStorage and refreshed automatically. Its access token is the bearer
 * token for every API call, and the server forwards it so RLS applies.
 *
 * Without Supabase (development): a random id in localStorage, sent as
 * "dev.<uuid>". The server accepts that only when it runs the memory store.
 */

export class AuthError extends Error {
  constructor(readonly code: "anon_disabled" | "auth_failed" | "unauthenticated") {
    super(code);
  }
}

let config: PublicConfig | null = null;
let supabase: SupabaseClient | null = null;

export function initAuth(c: PublicConfig) {
  if (config === c) return;
  config = c;
  supabase = c.supabase ? createClient(c.supabase.url, c.supabase.publishableKey) : null;
}

export function supabaseClient(): SupabaseClient | null {
  return supabase;
}

/** Current token, or null when the visitor has not started the trial. */
export async function currentToken(): Promise<string | null> {
  if (!supabase) {
    const id = getPref("devUserId");
    return id ? `dev.${id}` : null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Called once, after consent: creates the anonymous identity. */
export async function startTrialIdentity(): Promise<string> {
  const existing = await currentToken();
  if (existing) return existing;
  if (!supabase) {
    const id = crypto.randomUUID();
    setPrefs({ devUserId: id });
    return `dev.${id}`;
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) {
    const disabled = error?.code === "anonymous_provider_disabled" || /anonymous.*disabled/i.test(error?.message ?? "");
    throw new AuthError(disabled ? "anon_disabled" : "auth_failed");
  }
  return data.session.access_token;
}

/** Forgets this browser's identity and preferences (after delete everything). */
export async function forgetIdentity() {
  try {
    await supabase?.auth.signOut({ scope: "local" });
  } catch {
    // The user may already be gone on the server; local state is what matters.
  }
  clearPrefs();
}

/** Turns the anonymous user into a permanent one; the user id stays the same. */
export async function linkEmail(email: string, redirectTo: string): Promise<"sent" | "unavailable"> {
  if (!supabase) return "unavailable";
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
  if (error) throw new AuthError("auth_failed");
  return "sent";
}

export async function currentEmail(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user && !data.user.is_anonymous ? (data.user.email ?? null) : null;
}
