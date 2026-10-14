/*
 * Storm Central service worker — persistent radar tile cache, plus an offline
 * app shell (see the end of this file).
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
        if (name.startsWith("app-shell-") && name !== SHELL) await caches.delete(name);
      }
      await trimShell();
      await trim(true);
      await self.clients.claim();
    })(),
  );
});

// Tapping a weather notification (mobile browsers show them through this worker) opens the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (IMMUTABLE_TILE.test(request.url)) {
    event.respondWith(cacheFirst(request, event));
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") event.respondWith(shellPage(request, event));
  else if (url.pathname.startsWith("/_next/static/") || /^\/(icons|vendor)\//.test(url.pathname) || url.pathname === "/icon.svg") {
    event.respondWith(shellAsset(request, event));
  }
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

// ─── Offline app shell ──────────────────────────────────────────────────────
//
// Pages are network-first (always the latest when online) and kept as a
// fallback; Next's hashed /_next/static files never change, so they're
// cache-first. With no signal the app still opens and shows the forecast the
// page saved on the device, labelled with when it was saved. API calls are
// never cached here.

const SHELL = "app-shell-v1";
const SHELL_MAX = 400;

async function shellPage(request, event) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (err) {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (await cache.match("/"));
    if (hit) return hit;
    throw err;
  }
}

async function shellAsset(request, event) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    event.waitUntil(cache.put(request, response.clone()).then(() => (Math.random() < 0.05 ? trimShell() : undefined)));
  }
  return response;
}

/** Keep the shell cache bounded: oldest entries go first (old builds' chunks pile up otherwise). */
async function trimShell() {
  const cache = await caches.open(SHELL);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - SHELL_MAX; i++) await cache.delete(keys[i]);
}
