import { describe, expect, it } from "vitest";
import { coordinatesLabel, distanceM, NOMINATIM, PlaceNamer, placeKey, shortPlaceName, type PlaceDeps } from "@/lib/client/moments-place";

const MODA = { lat: 40.98365, lon: 29.02604 };
const NEARBY = { lat: 40.98612, lon: 29.0282 }; // about 330 m away
const FAR = { lat: 41.03699, lon: 28.98505 }; // Taksim, about 7 km away

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

/** A clock the test moves, and a Nominatim that answers with a name per call. */
function rig(opts: { fail?: boolean; storage?: ReturnType<typeof memoryStorage> } = {}) {
  let now = 1_000_000;
  const urls: string[] = [];
  const deps: PlaceDeps = {
    now: () => now,
    storage: opts.storage ?? memoryStorage(),
    fetch: async (url) => {
      urls.push(url);
      if (opts.fail) throw new TypeError("offline");
      const n = urls.length;
      return new Response(JSON.stringify({ name: "", address: { road: `Road ${n}`, suburb: "Kadıköy", city: "İstanbul" } }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  };
  return { namer: new PlaceNamer(deps), urls, advance: (ms: number) => (now += ms), deps };
}

describe("place names", () => {
  it("looks a spot up once, then answers from the cache", async () => {
    const { namer, urls } = rig();
    expect(await namer.name(MODA.lat, MODA.lon, "tr")).toBe("Road 1, Kadıköy");
    expect(await namer.name(MODA.lat + 0.0001, MODA.lon - 0.0001, "tr")).toBe("Road 1, Kadıköy");
    expect(urls).toHaveLength(1);
    expect(urls[0]!.startsWith(`${NOMINATIM}?format=jsonv2&lat=40.98365&lon=29.02604`)).toBe(true);
    expect(urls[0]).toContain("accept-language=tr");
  });

  it("asks OpenStreetMap at most once a minute", async () => {
    const { namer, urls, advance } = rig();
    await namer.name(MODA.lat, MODA.lon, "en");
    advance(20_000);
    // Within the minute: a spot close by borrows the name it is near...
    expect(await namer.name(NEARBY.lat, NEARBY.lon, "en")).toBe("Road 1, Kadıköy");
    // ...and one far away stays unnamed.
    expect(await namer.name(FAR.lat, FAR.lon, "en")).toBeNull();
    expect(urls).toHaveLength(1);
    advance(41_000);
    expect(await namer.name(FAR.lat, FAR.lon, "en")).toBe("Road 2, Kadıköy");
    expect(urls).toHaveLength(2);
    expect(namer.lookups).toBe(2);
  });

  it("sends one lookup for the same spot asked twice at once", async () => {
    const { namer, urls } = rig();
    const [a, b] = await Promise.all([namer.name(MODA.lat, MODA.lon, "en"), namer.name(MODA.lat, MODA.lon, "en")]);
    expect(a).toBe("Road 1, Kadıköy");
    expect(b).toBe("Road 1, Kadıköy");
    expect(urls).toHaveLength(1);
  });

  it("keeps names on the device, so the next page needs no lookup", async () => {
    const storage = memoryStorage();
    const first = rig({ storage });
    await first.namer.name(MODA.lat, MODA.lon, "en");
    const second = rig({ storage });
    expect(await second.namer.name(MODA.lat, MODA.lon, "en")).toBe("Road 1, Kadıköy");
    expect(second.urls).toHaveLength(0);
    // Names are per language.
    expect(placeKey(MODA.lat, MODA.lon, "en")).not.toBe(placeKey(MODA.lat, MODA.lon, "tr"));
  });

  it("answers null when the lookup fails, and still waits out the minute", async () => {
    const { namer, urls, advance } = rig({ fail: true });
    expect(await namer.name(MODA.lat, MODA.lon, "en")).toBeNull();
    advance(5000);
    expect(await namer.name(MODA.lat, MODA.lon, "en")).toBeNull();
    expect(urls).toHaveLength(1);
  });

  it("makes a short name from what Nominatim returns", () => {
    expect(shortPlaceName({ name: "Kronotrop", address: { road: "Firuzağa Camii Sokak", suburb: "Cihangir", city: "İstanbul" } })).toBe(
      "Kronotrop, Cihangir",
    );
    expect(shortPlaceName({ address: { road: "Moda Caddesi", suburb: "Caferağa Mahallesi", town: "Kadıköy", city: "İstanbul" } })).toBe(
      "Moda Caddesi, Kadıköy",
    );
    expect(shortPlaceName({ address: { road: "Baker Street", suburb: "Marylebone", city: "London" } })).toBe("Baker Street, Marylebone");
    expect(shortPlaceName({ address: { town: "Bodrum" } })).toBe("Bodrum");
    expect(shortPlaceName({ display_name: "Bebek, Beşiktaş, İstanbul, Türkiye" })).toBe("Bebek, Beşiktaş");
    expect(shortPlaceName({})).toBeNull();
  });

  it("measures distance and labels bare coordinates", () => {
    expect(distanceM(MODA.lat, MODA.lon, NEARBY.lat, NEARBY.lon)).toBeGreaterThan(250);
    expect(distanceM(MODA.lat, MODA.lon, NEARBY.lat, NEARBY.lon)).toBeLessThan(400);
    expect(distanceM(MODA.lat, MODA.lon, FAR.lat, FAR.lon)).toBeGreaterThan(5000);
    expect(coordinatesLabel(41.04301, 29.009412)).toBe("41.0430, 29.0094");
  });
});
