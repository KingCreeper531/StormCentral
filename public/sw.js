/*
 * StormCentral service worker — persistent radar tile cache.
 *
 * IEM RIDGE tiles addressed by scan timestamp (ridge::SITE-PROD-YYYYMMDDHHMM)
 * are immutable, so they're served cache-first. That makes radar loops
 * re-buffer from disk after pans, zooms, product flips and reloads, instead
 * of re-hitting the network. The cache is bounded by entry count and age so
 * it can't grow without limit (radar is only interesting for a few hours).
 */
const CACHE = "radar-tiles-v1";
const MAX_ENTRIES = 4000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STAMP = "x-sw-cached-at";
const IMMUTABLE_TILE = /\/cache\/tile\.py\/1\.0\.0\/ridge::[A-Z]{3,6}-[A-Z0-9]{3}-\d{12}\/\d+\/\d+\/\d+\.png$/;

let putsSinceTrim = 0;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("radar-tiles-") && name !== CACHE) await caches.delete(name);
      }
      await trim(true);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !IMMUTABLE_TILE.test(request.url)) return;
  event.respondWith(cacheFirst(request, event));
});

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) {
    const at = Number(hit.headers.get(STAMP));
    if (!at || Date.now() - at < MAX_AGE_MS) return hit;
  }
  const response = await fetch(request);
  // Only cache readable (CORS) successes; opaque responses would poison the cache.
  if (response.ok && response.type !== "opaque") {
    event.waitUntil(
      (async () => {
        const headers = new Headers(response.headers);
        headers.set(STAMP, String(Date.now()));
        const body = await response.clone().arrayBuffer();
        await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));
        if (++putsSinceTrim >= 200) {
          putsSinceTrim = 0;
          await trim(false);
        }
      })(),
    );
  }
  return response;
}

/** Evict oldest-inserted entries over budget (Cache.keys() is insertion-ordered). */
async function trim(purgeExpired) {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  if (!purgeExpired) return;
  const now = Date.now();
  for (const req of keys.slice(Math.max(0, excess))) {
    const res = await cache.match(req);
    const at = Number(res && res.headers.get(STAMP));
    if (!at || now - at > MAX_AGE_MS) await cache.delete(req);
  }
}
