import { createHash } from "node:crypto";
import { LruCache } from "../lru";

/**
 * Sliding-window rate limiter.
 *
 * With UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set (or the
 * KV_REST_API_URL / KV_REST_API_TOKEN names Vercel's Upstash integration
 * uses), the windows live in Upstash Redis, so every serverless instance
 * counts against the same limit. Without them (the desktop app, local
 * development), or for a request where Redis errors or is slow, the window
 * is kept in this process's memory.
 *
 * Either way: a refused request isn't counted, and the retry time is from the
 * oldest request in the window. Each kind of limit (the key's prefix: "login-ip"
 * in "login-ip:1.2.3.4") has an in-memory store of its own, so flooding one
 * with new keys can't push another's counters out.
 */
export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSec: number };

const stores = new Map<string, LruCache<number[]>>();

function storeFor(key: string) {
  const prefix = key.slice(0, Math.max(0, key.indexOf(":")));
  let store = stores.get(prefix);
  if (!store) stores.set(prefix, (store = new LruCache<number[]>({ maxEntries: 20_000 })));
  return store;
}

/** The in-memory limiter (one process). */
export function memoryRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const windows = storeFor(key);
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    // A refused request isn't counted, and never makes a new entry.
    if (hits.length) windows.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - (hits[0] ?? now))) / 1000) };
  }
  hits.push(now);
  windows.set(key, hits);
  return { ok: true, remaining: limit - hits.length };
}

/**
 * The same window as memoryRateLimit, as one atomic script over a sorted set
 * of request times. Returns {1, remaining} or {0, ms until the oldest leaves}.
 */
const WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local first = tonumber(oldest[2]) or now
  return {0, window - (now - first)}
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, window)
return {1, limit - count - 1}
`;

/** How long to wait on Redis before counting this request in memory instead. */
const REDIS_TIMEOUT_MS = 1_000;

/**
 * The Redis key for a limit key: the prefix stays readable, the rest (an IP,
 * a user id or an email address) is hashed, so no address is stored with Upstash.
 */
export function redisKey(key: string): string {
  const colon = key.indexOf(":");
  const prefix = colon < 0 ? "" : key.slice(0, colon);
  return `rl:${prefix}:${createHash("sha256").update(key).digest("base64url").slice(0, 32)}`;
}

/** A limiter backed by Upstash's REST API (plain fetch, no client library). */
export function upstashRateLimit(url: string, token: string, fetchImpl: typeof fetch = fetch) {
  const endpoint = url.replace(/\/+$/, "");
  return async (key: string, limit: number, windowMs: number, now: number): Promise<RateLimitResult> => {
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", WINDOW_SCRIPT, "1", redisKey(key), String(now), String(windowMs), String(limit), member]),
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!res.ok || !data || data.error) throw new Error(`Upstash ${res.status}${data?.error ? `: ${data.error}` : ""}`);
    const [allowed = NaN, n = NaN] = Array.isArray(data.result) ? data.result.map(Number) : [];
    if (!Number.isFinite(allowed) || !Number.isFinite(n)) throw new Error("Upstash: unexpected reply");
    return allowed === 1 ? { ok: true, remaining: Math.max(0, n) } : { ok: false, retryAfterSec: Math.max(1, Math.ceil(n / 1000)) };
  };
}

type Shared = ReturnType<typeof upstashRateLimit>;
let shared: { config: string; limiter: Shared } | null = null;

/** The shared limiter when Upstash is configured, else null. */
function sharedLimiter(): Shared | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;
  const config = `${url}\n${token}`;
  if (shared?.config !== config) shared = { config, limiter: upstashRateLimit(url, token) };
  return shared.limiter;
}

let lastWarning = 0;

/**
 * Counts a request against `limit` per `windowMs` for `key` ("kind:who"),
 * shared across instances when Upstash is configured.
 */
export async function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  const limiter = sharedLimiter();
  if (limiter) {
    try {
      return await limiter(key, limit, windowMs, now);
    } catch (err) {
      if (Date.now() - lastWarning > 60_000) {
        lastWarning = Date.now();
        console.warn(`[rate-limit] shared store failed, counting in memory: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return memoryRateLimit(key, limit, windowMs, now);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
