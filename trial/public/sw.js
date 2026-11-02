/*
 * Signalive's service worker, kept small on purpose. It keeps the app's
 * shell and its static files, so the installed app opens quickly and still
 * opens without a connection, and it never touches the API: nothing anyone
 * said, and no answer, is ever cached here. Moments live in IndexedDB,
 * which this worker does not handle.
 *
 *   /api/*                       never: straight to the network
 *   router data (RSC requests)   never: straight to the network
 *   /_next/static, /icons, /brand  cache first (their names change when they do)
 *   pages                        network first, the same page's cached copy when offline
 *   anything else                not handled
 */
const VERSION = "signalive-shell-v1";
const SHELL = ["/moments", "/ask", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
const STATIC = ["/_next/static/", "/icons/", "/brand/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pages are rendered per request (no-store) but carry nothing personal: what a
// person keeps is drawn on the device, from IndexedDB, after the page loads.
// So a page's last copy is kept for opening offline; the network always wins.
function cacheable(response) {
  return Boolean(response && response.ok && response.type === "basic");
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (cacheable(response)) cache.put(request, response.clone()).catch(() => undefined);
    return response;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.has("RSC") || url.searchParams.has("_rsc") || request.headers.has("Next-Router-State-Tree")) return;
  if (STATIC.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") event.respondWith(networkFirst(request));
});
