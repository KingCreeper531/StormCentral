import { LruCache } from "../lru";

/**
 * Sliding-window rate limiter (per process). Good enough for a single
 * instance; swap the store for Redis/Upstash when horizontally scaling.
 * Each kind of limit (the key's prefix: "login-ip" in "login-ip:1.2.3.4")
 * has a store of its own, so flooding one with new keys can't push another's
 * counters out.
 */
const stores = new Map<string, LruCache<number[]>>();

function storeFor(key: string) {
  const prefix = key.slice(0, Math.max(0, key.indexOf(":")));
  let store = stores.get(prefix);
  if (!store) stores.set(prefix, (store = new LruCache<number[]>({ maxEntries: 20_000 })));
  return store;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const windows = storeFor(key);
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    // A refused request isn't counted, and never makes a new entry.
    if (hits.length) windows.set(key, hits);
    return { ok: false as const, retryAfterSec: Math.ceil((windowMs - (now - (hits[0] ?? now))) / 1000) };
  }
  hits.push(now);
  windows.set(key, hits);
  return { ok: true as const, remaining: limit - hits.length };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
