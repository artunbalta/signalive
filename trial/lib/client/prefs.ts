"use client";

import { useSyncExternalStore } from "react";
import type { Lang, SpeechLang } from "@/lib/shared/types";
import type { GestureBindings } from "@/lib/gestures/types";

/**
 * Per device preferences in localStorage. Only conveniences live here:
 * choices like the selected microphone, and ids that let a returning visitor
 * pick up where they left off. Anything that matters (consents, data) is on
 * the server. Every access survives a blocked or empty storage.
 */

export interface Prefs {
  devUserId?: string;
  consentVersion?: string;
  inputDeviceId?: string;
  outputDeviceId?: string;
  inputLabel?: string;
  outputLabel?: string;
  speechLang?: SpeechLang;
  whisper?: boolean;
  whisperGainDb?: number;
  handsFree?: boolean;
  bargeIn?: boolean;
  keepRawAudio?: boolean;
  mediaKeys?: boolean;
  gestureBindings?: GestureBindings;
  setupDone?: boolean;
  labLanguage?: Lang;
}

const KEY = "signalive.trial.v1";
const listeners = new Set<() => void>();
let cache: Prefs | null = null;

function load(): Prefs {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Prefs;
  } catch {
    cache = {};
  }
  return cache;
}

export function getPrefs(): Prefs {
  if (typeof window === "undefined") return {};
  return load();
}

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return getPrefs()[key];
}

export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...load(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private mode or blocked storage: the in-memory copy still works.
  }
  for (const l of listeners) l();
}

export function clearPrefs() {
  cache = {};
  try {
    localStorage.removeItem(KEY);
    sessionStorage.clear();
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const EMPTY: Prefs = {};

/** Reactive read of all preferences. */
export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, () => EMPTY);
}

/** Landing time for the "page open to first reply" measurement. */
export function markLanding() {
  try {
    if (!sessionStorage.getItem("signalive.landingAt")) sessionStorage.setItem("signalive.landingAt", String(Date.now()));
  } catch {
    // ignore
  }
}

export function landingAt(): number | null {
  try {
    const v = Number(sessionStorage.getItem("signalive.landingAt"));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
