import type { MomentPlace } from "@/lib/shared/moments";
import { nativeApi } from "./moments-ics";

/**
 * Where a moment was kept, only when the wearer turned it on in Settings.
 * The position comes from the browser's Geolocation; its name is looked up
 * on the device through OpenStreetMap's Nominatim, at most once a minute
 * (their usage policy asks for no more than one request a second; once a
 * minute is far below that), and every name is cached on the device, so the
 * same spot is never asked about twice. Nothing about places goes to the
 * Signalive server except the name, inside one moment's request.
 */

export const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";

export interface PlaceDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

export interface CachedPlace {
  key: string;
  lat: number;
  lon: number;
  lang: "en" | "tr";
  name: string;
}

const CACHE_KEY = "signalive.places.v1";
const CACHE_MAX = 60;

/** About 110 m: a spot the same name can stand for. */
export function placeKey(lat: number, lon: number, lang: "en" | "tr"): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)},${lang}`;
}

/** Metres between two points, haversine. */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLon = r(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Address = Partial<
  Record<
    | "road" | "pedestrian" | "footway" | "square" | "neighbourhood" | "quarter" | "suburb" | "city_district" | "district"
    | "borough" | "town" | "city" | "village" | "municipality" | "county" | "state" | "country",
    string
  >
>;

/**
 * A short name from a Nominatim reverse result: the place itself or the
 * street, then the district or town, such as "Moda Caddesi, Kadıköy".
 */
export function shortPlaceName(data: { name?: string; display_name?: string; address?: Address }): string | null {
  const a = data.address ?? {};
  const first = data.name?.trim() || a.road || a.pedestrian || a.square || a.footway || a.neighbourhood || a.quarter || a.suburb;
  // In Turkey the suburb is the mahalle ("Caferağa Mahallesi"); the district (Kadıköy) reads better after a street.
  const suburb = a.suburb && !/\b(Mahallesi|Mah\.)$/i.test(a.suburb) ? a.suburb : undefined;
  const second = [suburb, a.city_district, a.district, a.borough, a.town, a.city, a.village, a.municipality, a.county].find(
    (x) => x && x !== first,
  );
  const name = [first, second].filter(Boolean).join(", ");
  if (name) return name.slice(0, 160);
  const fallback = data.display_name?.split(",").slice(0, 2).map((s) => s.trim()).filter(Boolean).join(", ");
  return fallback ? fallback.slice(0, 160) : null;
}

export class PlaceNamer {
  /** At most one lookup a minute. */
  static readonly MIN_INTERVAL_MS = 60_000;
  /** While waiting out the minute, a name cached this close stands in. */
  static readonly NEAR_M = 1000;

  private cache: CachedPlace[];
  private lastLookupAt = -Infinity;
  private inflight: Promise<string | null> | null = null;
  /** Lookups actually sent, for tests and for honesty. */
  lookups = 0;

  constructor(private readonly deps: PlaceDeps) {
    this.cache = this.read();
  }

  /**
   * The name of the spot: cached when it was named before, else looked up
   * when a minute has passed since the last lookup, else the name of a spot
   * cached within a kilometre, else null.
   */
  async name(lat: number, lon: number, lang: "en" | "tr", signal?: AbortSignal): Promise<string | null> {
    const key = placeKey(lat, lon, lang);
    const hit = this.cache.find((c) => c.key === key);
    if (hit) return hit.name;
    if (this.inflight) {
      await this.inflight.catch(() => null);
      const after = this.cache.find((c) => c.key === key);
      if (after) return after.name;
    }
    if (this.deps.now() - this.lastLookupAt < PlaceNamer.MIN_INTERVAL_MS) return this.nearby(lat, lon, lang);
    this.lastLookupAt = this.deps.now();
    this.lookups++;
    this.inflight = this.lookup(lat, lon, lang, signal);
    try {
      const name = await this.inflight;
      if (name) this.remember({ key, lat, lon, lang, name });
      return name ?? this.nearby(lat, lon, lang);
    } finally {
      this.inflight = null;
    }
  }

  private nearby(lat: number, lon: number, lang: "en" | "tr"): string | null {
    let best: CachedPlace | null = null;
    let bestM = PlaceNamer.NEAR_M;
    for (const c of this.cache) {
      if (c.lang !== lang) continue;
      const d = distanceM(lat, lon, c.lat, c.lon);
      if (d <= bestM) {
        best = c;
        bestM = d;
      }
    }
    return best?.name ?? null;
  }

  private async lookup(lat: number, lon: number, lang: "en" | "tr", signal?: AbortSignal): Promise<string | null> {
    const url = `${NOMINATIM}?format=jsonv2&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=17&addressdetails=1&accept-language=${lang}`;
    try {
      const res = await this.deps.fetch(url, { signal, headers: { Accept: "application/json" }, referrerPolicy: "origin", credentials: "omit" });
      if (!res.ok) return null;
      return shortPlaceName((await res.json()) as Parameters<typeof shortPlaceName>[0]);
    } catch {
      return null;
    }
  }

  private remember(p: CachedPlace) {
    this.cache = [p, ...this.cache.filter((c) => c.key !== p.key)].slice(0, CACHE_MAX);
    try {
      this.deps.storage?.setItem(CACHE_KEY, JSON.stringify(this.cache));
    } catch {
      // Storage full or blocked: the copy in memory still serves this page.
    }
  }

  private read(): CachedPlace[] {
    try {
      const v = JSON.parse(this.deps.storage?.getItem(CACHE_KEY) ?? "[]") as unknown;
      return Array.isArray(v)
        ? v.filter((c): c is CachedPlace => !!c && typeof c.key === "string" && typeof c.name === "string" && typeof c.lat === "number" && typeof c.lon === "number")
        : [];
    } catch {
      return [];
    }
  }
}

/* ---- The browser's side ---------------------------------------------------------- */

export type PositionResult = { lat: number; lon: number } | { error: "denied" | "unavailable" | "timeout" };

/**
 * Where the device is. Inside the Signalive app the shell's own location
 * (which asks with the phone's own prompt) answers; in a browser, Geolocation.
 */
export async function getPosition(timeoutMs = 6000): Promise<PositionResult> {
  const native = nativeApi()?.location;
  if (native && typeof native.current === "function") {
    try {
      const p = await Promise.race([
        native.current({ accuracy: "balanced" }),
        new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), timeoutMs)),
      ]);
      return { lat: p.latitude, lon: p.longitude };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      return { error: code === "permission_denied" ? "denied" : code === "timeout" ? "timeout" : "unavailable" };
    }
  }
  return browserPosition(timeoutMs);
}

function browserPosition(timeoutMs: number): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ error: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => resolve({ error: e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable" }),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: timeoutMs },
    );
  });
}

let namer: PlaceNamer | null = null;

function defaultNamer(): PlaceNamer {
  namer ??= new PlaceNamer({
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
  });
  return namer;
}

/** "41.0430, 29.0094", for a place whose name could not be found. */
export function coordinatesLabel(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * Where the wearer is now, named. `named` is false when only the coordinates
 * are known (the name lookup was throttled or failed); then the moment shows
 * coordinates and the server is told nothing.
 */
export async function currentPlace(lang: "en" | "tr", signal?: AbortSignal): Promise<(MomentPlace & { named: boolean }) | null> {
  const pos = await getPosition();
  if ("error" in pos) return null;
  const name = await defaultNamer().name(pos.lat, pos.lon, lang, signal);
  return { name: name ?? coordinatesLabel(pos.lat, pos.lon), lat: pos.lat, lon: pos.lon, named: name !== null };
}
