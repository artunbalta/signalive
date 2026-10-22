"use client";

import type { DeviceProfile, DeviceProfileInput, Lang, Session, SpeechLang } from "@/lib/shared/types";
import { api } from "./api";
import { detectPlatform } from "./platform";
import { getPrefs } from "./prefs";

/**
 * A session is one visit (one tab). Its id lives in sessionStorage, so a
 * reload continues it and a new tab starts a new one. Each session gets its
 * own device profile row; measurements from earlier visits are carried over
 * from a local cache, and media key results start fresh each visit.
 */

const SESSION_KEY = "signalive.session";
const PROFILE_CACHE = "signalive.deviceProfile";

interface SessionInfo {
  id: string;
  deviceProfileId?: string;
}

function readSession(): SessionInfo | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as SessionInfo | null;
  } catch {
    return null;
  }
}

function writeSession(s: SessionInfo) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // ignore: the in-memory fallback below still holds it
  }
  memorySession = s;
}

let memorySession: SessionInfo | null = null;
let creating: Promise<string> | null = null;

export function sessionId(): string | null {
  return (readSession() ?? memorySession)?.id ?? null;
}

export function deviceProfileId(): string | null {
  return (readSession() ?? memorySession)?.deviceProfileId ?? null;
}

export function ensureSession(uiLang: Lang): Promise<string> {
  const existing = sessionId();
  if (existing) return Promise.resolve(existing);
  creating ??= (async () => {
    try {
      const p = detectPlatform();
      const speechLang: SpeechLang = getPrefs().speechLang ?? uiLang;
      const s = await api<Session>("/api/session", {
        method: "POST",
        json: { uiLang, speechLang, browser: p.browser, os: p.os },
      });
      writeSession({ id: s.id });
      return s.id;
    } finally {
      creating = null;
    }
  })();
  return creating;
}

/**
 * Forgets this visit's session, so the next ensureSession starts a new one.
 * keepProfileCache keeps the earlier device measurements for that session
 * (used when only the server's copy was lost, not after delete everything).
 */
export function forgetSession({ keepProfileCache = false }: { keepProfileCache?: boolean } = {}) {
  memorySession = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
    if (!keepProfileCache) localStorage.removeItem(PROFILE_CACHE);
  } catch {
    // ignore
  }
}

/* ----------------------------------------------------------------------------
   Device profile
   ------------------------------------------------------------------------- */

type ProfileData = Omit<DeviceProfileInput, "sessionId">;

export function cachedProfile(): ProfileData | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_CACHE) ?? "null") as ProfileData | null;
  } catch {
    return null;
  }
}

function emptyProfile(): ProfileData {
  const p = detectPlatform();
  return {
    inputLabel: "",
    outputLabel: null,
    trackSampleRate: null,
    contextSampleRate: null,
    channelCount: null,
    browser: p.browser,
    os: p.os,
    isMobile: p.isMobile,
    bluetoothSuspected: false,
    handsFreeSuspected: false,
    effectiveBandwidthHz: null,
    rmsDbfs: null,
    peakDbfs: null,
    noiseFloorDbfs: null,
    windLowFreqRatio: null,
    outputSelectable: false,
    mediaKeys: {},
    extra: {},
  };
}

let saving: Promise<DeviceProfile> = Promise.resolve(null as unknown as DeviceProfile);

/** Merges a patch into this session's device profile and saves it. */
export function saveDeviceProfile(patch: Partial<ProfileData>): Promise<DeviceProfile> {
  // Serialized, so a quick sequence of patches cannot create two rows.
  saving = saving.catch(() => null).then(async () => {
    const sid = sessionId();
    if (!sid) throw new Error("no session");
    const cached = cachedProfile();
    const isNewSession = !deviceProfileId();
    const data: ProfileData = {
      ...emptyProfile(),
      ...(cached ?? {}),
      // Media key results describe this visit only.
      ...(isNewSession ? { mediaKeys: {} } : {}),
      ...patch,
      extra: { ...(cached?.extra ?? {}), ...(patch.extra ?? {}) },
    };
    const saved = await api<DeviceProfile>("/api/device-profile", {
      method: "POST",
      json: { id: deviceProfileId() ?? undefined, ...data, sessionId: sid },
    });
    try {
      localStorage.setItem(PROFILE_CACHE, JSON.stringify(data));
    } catch {
      // ignore
    }
    writeSession({ id: sid, deviceProfileId: saved.id });
    return saved;
  });
  return saving;
}
