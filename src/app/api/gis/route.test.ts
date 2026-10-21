import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/gis-proxy", () => ({ fetchGis: async () => ({ body: new TextEncoder().encode("Title: x\n"), type: "text/plain; charset=utf-8" }) }));

const { GET } = await import("./route");

const get = (ip: string) => GET(new Request("https://storm.test/api/gis?url=https%3A%2F%2Ffeeds.test%2Fa.txt", { headers: { "x-forwarded-for": ip } }));

describe("/api/gis", () => {
  it("is rate-limited per IP", async () => {
    for (let i = 0; i < 120; i++) expect((await get("192.0.2.1")).status).toBe(200);
    const res = await get("192.0.2.1");
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await get("192.0.2.2")).status).toBe(200);
  });
});
