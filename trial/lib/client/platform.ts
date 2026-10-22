"use client";

export interface Platform {
  browser: string;
  os: string;
  isMobile: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isSafari: boolean;
}

/** Coarse browser and OS names for the device profile and help texts. */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") {
    return { browser: "unknown", os: "unknown", isMobile: false, isIOS: false, isAndroid: false, isSafari: false };
  }
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const os = isIOS ? "iOS"
    : isAndroid ? "Android"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "unknown";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /Safari/.test(ua) ? "Safari"
    : "unknown";
  const isSafari = browser === "Safari" || (isIOS && !/CriOS|FxiOS|EdgiOS/.test(ua));
  return { browser, os, isMobile: isIOS || isAndroid || /Mobile/.test(ua), isIOS, isAndroid, isSafari };
}

export const PROVIDER_NAMES: Record<string, string> = {
  deepgram: "Deepgram",
  openai: "OpenAI",
  groq: "Groq",
  elevenlabs: "ElevenLabs",
  anthropic: "Anthropic (Claude)",
  voyage: "Voyage AI",
  mock: "mock",
};
