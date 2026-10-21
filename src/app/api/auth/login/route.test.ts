import { beforeEach, describe, expect, it, vi } from "vitest";

const limits = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@/lib/server/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/server/rate-limit")>();
  return { ...real, rateLimit: (key: string, ...rest: [number, number]) => (limits.keys.push(key), real.rateLimit(key, ...rest)) };
});
vi.mock("@/lib/db/client", () => ({ getDb: async () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) }) }));
vi.mock("@/lib/auth/password", () => ({ verifyAgainstDummy: async () => false, verifyPassword: async () => false }));

const { POST } = await import("./route");

const login = (ip: string, body: BodyInit, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://storm.test/api/auth/login", {
      method: "POST",
      headers: { host: "storm.test", origin: "https://storm.test", "x-forwarded-for": ip, "content-type": "application/json", ...headers },
      body,
      duplex: "half",
    } as RequestInit),
  );

beforeEach(() => {
  limits.keys = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("/api/auth/login", () => {
  it("refuses a throttled IP before reading the body, without touching the account counters", async () => {
    for (let i = 0; i < 20; i++) expect((await login("203.0.113.9", JSON.stringify({ identifier: `user${i}`, password: "pw" }))).status).toBe(401);
    expect(limits.keys.filter((k) => k.startsWith("login-acct:"))).toHaveLength(20);

    limits.keys = [];
    let pulled = 0;
    const body = new ReadableStream({ pull: (c) => (pulled++, c.close()) }, { highWaterMark: 0 });
    const res = await login("203.0.113.9", body);
    expect(res.status).toBe(429);
    expect(pulled).toBe(0);
    for (let i = 0; i < 50; i++) await login("203.0.113.9", JSON.stringify({ identifier: `flood${i}`, password: "pw" }));
    expect(limits.keys.every((k) => k.startsWith("login-ip:"))).toBe(true);
  });

  it("refuses an oversized body", async () => {
    expect((await login("203.0.113.10", "{}", { "content-length": String(1024 * 1024) })).status).toBe(413);
    expect((await login("203.0.113.10", JSON.stringify({ identifier: "bob", password: "x".repeat(40_000) }))).status).toBe(413);
    expect((await login("203.0.113.10", "{not json")).status).toBe(400);
  });
});
