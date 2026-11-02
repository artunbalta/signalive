import { originOf } from "./shell/navigation";

/**
 * Where the web app lives. EXPO_PUBLIC_APP_URL is inlined when the bundle is
 * built (eas.json sets it per build profile; for a dev build on a phone, put
 * it in mobile/.env.local, for example http://192.168.1.20:3000). The default
 * is a placeholder for the trial's production URL until it has its domain.
 */
export const DEFAULT_APP_URL = "https://trial.signalive.com";

export interface AppTarget {
  /** The page the WebView opens. */
  url: string;
  /** Its origin: the only one that loads inside the shell and the only one the bridge answers. */
  origin: string;
}

/** An http(s) URL with a host, or the default. Anything else (a typo, an empty variable) falls back rather than loading nothing. */
export function resolveAppTarget(raw: string | undefined | null, fallback = DEFAULT_APP_URL): AppTarget {
  const url = (raw ?? "").trim();
  const origin = /^https?:\/\//i.test(url) ? originOf(url) : null;
  if (origin) return { url, origin };
  return { url: fallback, origin: originOf(fallback)! };
}

export const APP: AppTarget = resolveAppTarget(process.env.EXPO_PUBLIC_APP_URL);

/** The trial's own colors (trial/app/globals.css): ink, paper, mist, fog, well, hairline. */
export const COLORS = {
  ink: "#0B0B0C",
  paper: "#FFFFF9",
  mist: "#B4B4B9",
  fog: "#8A8A8F",
  well: "#131316",
  hairline: "rgba(255, 255, 249, 0.18)",
} as const;
