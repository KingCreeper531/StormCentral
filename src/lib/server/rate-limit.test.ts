import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryRateLimit, rateLimit, redisKey, upstashRateLimit } from "./rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("rate limit (in memory, no shared store configured)", () => {
  it("allows up to the limit in the window, then says when to retry", async () => {
    const t = 1_000_000;
    expect(await rateLimit("t-basic:a", 2, 60_000, t)).toEqual({ ok: true, remaining: 1 });
    expect(await rateLimit("t-basic:a", 2, 60_000, t + 1000)).toEqual({ ok: true, remaining: 0 });
    expect(await rateLimit("t-basic:a", 2, 60_000, t + 2000)).toEqual({ ok: false, retryAfterSec: 58 });
    expect((await rateLimit("t-basic:a", 2, 60_000, t + 60_001)).ok).toBe(true);
  });

  it("doesn't count refused requests", async () => {
    const t = 2_000_000;
    await rateLimit("t-refused:a", 1, 60_000, t);
    for (let i = 1; i <= 50; i++) expect((await rateLimit("t-refused:a", 1, 60_000, t + i * 1000)).ok).toBe(false);
    // Free again a window after the one request that counted, not after the last refused one.
    expect((await rateLimit("t-refused:a", 1, 60_000, t + 60_000)).ok).toBe(true);
  });

  it("keeps each kind of limit apart, so flooding one can't reset another", () => {
    const t = 3_000_000;
    for (let i = 0; i < 8; i++) memoryRateLimit("t-acct:victim", 8, 60_000, t);
    expect(memoryRateLimit("t-acct:victim", 8, 60_000, t).ok).toBe(false);
    // More made-up keys than a store holds, all under another prefix.
    for (let i = 0; i < 25_000; i++) memoryRateLimit(`t-ip:${i}`, 20, 60_000, t);
    expect(memoryRateLimit("t-acct:victim", 8, 60_000, t + 1).ok).toBe(false);
  });
});

/** A stand-in for Upstash's REST endpoint that runs the window script's logic on a sorted set per key. */
function fakeUpstash() {
  const sets = new Map<string, { score: number; member: string }[]>();
  const calls: { url: string; auth: string | null; command: string[] }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as string[];
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), command });
    const [, , , key = "", nowS = "", windowS = "", limitS = "", member = ""] = command;
    const [now, window, limit] = [Number(nowS), Number(windowS), Number(limitS)];
    const set = (sets.get(key) ?? []).filter((e) => e.score > now - window);
    sets.set(key, set);
    if (set.length >= limit) return Response.json({ result: [0, window - (now - (set[0]?.score ?? now))] });
    set.push({ score: now, member });
    return Response.json({ result: [1, limit - set.length] });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, sets };
}

describe("rate limit (Upstash)", () => {
  it("sends one atomic script per request, with the token, and reads the window from Redis", async () => {
    const up = fakeUpstash();
    const limit = upstashRateLimit("https://eu1.upstash.test/", "secret-token", up.fetchImpl);
    const t = 5_000_000;
    expect(await limit("u-basic:a", 2, 60_000, t)).toEqual({ ok: true, remaining: 1 });
    expect(await limit("u-basic:a", 2, 60_000, t + 1000)).toEqual({ ok: true, remaining: 0 });
    expect(await limit("u-basic:a", 2, 60_000, t + 2000)).toEqual({ ok: false, retryAfterSec: 58 });
    expect((await limit("u-basic:a", 2, 60_000, t + 60_001)).ok).toBe(true);

    const [first] = up.calls;
    expect(first?.url).toBe("https://eu1.upstash.test");
    expect(first?.auth).toBe("Bearer secret-token");
    expect(first?.command.slice(0, 3)).toEqual(["EVAL", expect.stringContaining("ZREMRANGEBYSCORE"), "1"]);
    expect(first?.command.slice(4, 7)).toEqual([String(t), "60000", "2"]);
  });

  it("is shared: two instances count against the same window", async () => {
    const up = fakeUpstash();
    const a = upstashRateLimit("https://r.test", "t", up.fetchImpl);
    const b = upstashRateLimit("https://r.test", "t", up.fetchImpl);
    expect((await a("u-shared:x", 1, 60_000, 1)).ok).toBe(true);
    expect((await b("u-shared:x", 1, 60_000, 2)).ok).toBe(false);
  });

  it("keeps addresses out of Redis: the prefix stays, the rest is hashed", () => {
    const k = redisKey("forgot-acct:someone@example.com");
    expect(k).toMatch(/^rl:forgot-acct:[\w-]{32}$/);
    expect(k).not.toContain("example");
    expect(redisKey("forgot-acct:other@example.com")).not.toBe(k);
  });

  it("throws on an error reply, so the caller can fall back", async () => {
    const limit = upstashRateLimit("https://r.test", "t", (async () => Response.json({ error: "WRONGPASS" }, { status: 401 })) as unknown as typeof fetch);
    await expect(limit("u-err:a", 1, 1000, 1)).rejects.toThrow(/401: WRONGPASS/);
  });
});

describe("rateLimit picks the store from the environment", () => {
  it("uses Upstash when its URL and token are set", async () => {
    const up = fakeUpstash();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://env.upstash.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "env-token");
    vi.stubGlobal("fetch", up.fetchImpl);
    expect(await rateLimit("e-up:a", 1, 60_000, 10)).toEqual({ ok: true, remaining: 0 });
    expect((await rateLimit("e-up:a", 1, 60_000, 11)).ok).toBe(false);
    expect(up.calls).toHaveLength(2);
    expect(up.calls[0]?.auth).toBe("Bearer env-token");
  });

  it("accepts Vercel's KV_REST_API_* names too", async () => {
    const up = fakeUpstash();
    vi.stubEnv("KV_REST_API_URL", "https://kv.upstash.test");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
    vi.stubGlobal("fetch", up.fetchImpl);
    await rateLimit("e-kv:a", 1, 60_000, 10);
    expect(up.calls[0]?.url).toBe("https://kv.upstash.test");
  });

  it("falls back to memory when Redis fails, and still limits", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://down.upstash.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await rateLimit("e-down:a", 1, 60_000, 10)).toEqual({ ok: true, remaining: 0 });
    expect((await rateLimit("e-down:a", 1, 60_000, 11)).ok).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays in memory when only one of the two is set", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://half.upstash.test");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await rateLimit("e-half:a", 1, 60_000, 10)).ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
