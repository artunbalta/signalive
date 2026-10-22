import "server-only";
import { HttpError } from "./http";

/**
 * Per user sliding window limits for the routes that cost money (provider
 * calls). In memory, so each server instance counts on its own: a guard
 * against runaway clients and casual abuse, not a quota system. Anonymous
 * sign in should also have CAPTCHA enabled in Supabase for a public launch.
 */

const windows = new Map<string, number[]>();

const LIMITS = {
  assistant: { max: 40, windowMs: 60_000 },
  rewind: { max: 20, windowMs: 60_000 },
  focus: { max: 12, windowMs: 60_000 },
  stt: { max: 60, windowMs: 60_000 },
  grant: { max: 40, windowMs: 60_000 },
  lab: { max: 60, windowMs: 60_000 },
  notes: { max: 20, windowMs: 60_000 },
  search: { max: 60, windowMs: 60_000 },
} as const;

export function rateLimit(userId: string, kind: keyof typeof LIMITS) {
  const { max, windowMs } = LIMITS[kind];
  const key = `${kind}:${userId}`;
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    windows.set(key, hits);
    throw new HttpError(429, "rate_limited");
  }
  hits.push(now);
  windows.set(key, hits);
  if (windows.size > 10_000) {
    for (const [k, v] of windows) if (!v.some((t) => now - t < windowMs)) windows.delete(k);
  }
}
