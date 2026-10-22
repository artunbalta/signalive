import "server-only";
import * as env from "@/lib/server/env";
import { MemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";
import type { DataStore } from "./types";

let store: DataStore | undefined;

export function getStore(): DataStore {
  if (!store) {
    store =
      env.dataStore === "supabase" && env.supabase.url && env.supabase.publishableKey
        ? new SupabaseStore(env.supabase.url, env.supabase.publishableKey, env.supabase.secretKey)
        : new MemoryStore();
  }
  return store;
}
