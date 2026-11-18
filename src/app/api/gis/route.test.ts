import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/gis-proxy", () => ({ fetchGis: async () => ({ body: new TextEncoder().encode("Title: x\n"), type: "text/plain; charset=utf-8" }) }));

const { GET } = await import("./route");

const get = (ip: string, layer = "a") =>
  GET(new Request(`https://storm.test/api/gis?url=${encodeURIComponent(`https://feeds.test/${layer}.txt`)}`, { headers: { "x-forwarded-for": ip } }));

/** Each test starts on a fresh minute, so the windows of the one before don't carry over. */
let clock = Date.UTC(2026, 0, 1);
function freshMinute() {
  clock += 10 * 60_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("/api/gis", () => {
  it("is rate-limited per IP", async () => {
    freshMinute();
    for (let i = 0; i < 60; i++) expect((await get("192.0.2.1", `l${i % 20}`)).status).toBe(200);
    const res = await get("192.0.2.1");
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await get("192.0.2.2")).status).toBe(200);
  });

  it("keeps up with the most a radar asks for: 20 layers re-read every 30 s, plus their icon sheets", async () => {
    freshMinute();
    for (let i = 0; i < 20; i++) expect((await get("192.0.2.10", `icons${i}`)).status).toBe(200);
    for (let tick = 0; tick < 20; tick++) {
      for (let layer = 0; layer < 20; layer++) expect((await get("192.0.2.10", `layer${layer}`)).status).toBe(200);
      clock += 30_000;
      vi.setSystemTime(clock);
    }
  });

  it("has a cap on the whole proxy that many addresses together can't get past", async () => {
    freshMinute();
    let ok = 0;
    for (let i = 0; i < 1_300; i++) {
      const res = await get(`203.0.113.${i % 250}.${Math.floor(i / 250)}`, `g${i}`);
      if (res.status === 200) ok++;
      else expect(res.status).toBe(429);
    }
    expect(ok).toBe(1_200);
    // An address refused by its own limit doesn't use up the shared cap.
    clock += 2 * 60_000;
    vi.setSystemTime(clock);
    for (let i = 0; i < 100; i++) await get("198.51.100.50");
    expect((await get("198.51.100.51")).status).toBe(200);
  });
});
