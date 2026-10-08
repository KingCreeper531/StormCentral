import { LruCache } from "../lru";

/**
 * Sliding-window rate limiter (per process). Good enough for a single
 * instance; swap the store for Redis/Upstash when horizontally scaling.
 */
const windows = new LruCache<number[]>({ maxEntries: 20_000 });

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return { ok: false as const, retryAfterSec: Math.ceil((windowMs - (now - hits[0]!)) / 1000) };
  }
  hits.push(now);
  windows.set(key, hits);
  return { ok: true as const, remaining: limit - hits.length };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
