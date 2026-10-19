import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
const repo = vi.hoisted(() => ({
  upsertPosition: vi.fn(async (_id: string, p: { until: number }) => p.until),
  stopSharing: vi.fn(async () => {}),
  listChasers: vi.fn(async () => []),
  pruneChasers: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));
vi.mock("@/lib/server/chaser-repo", () => repo);

const { DELETE, GET, PUT } = await import("./route");

let n = 0;
const member = (extra: Partial<SessionUser> = {}): SessionUser => ({ id: `u${++n}`, username: `user${n}`, displayName: "User", avatarHue: 1, avatarUrl: null, moderator: false, suspendedUntil: null, ...extra });
const request = (method: string, body?: unknown, origin = "https://storm.test") =>
  new Request("https://storm.test/api/chasers", {
    method,
    headers: { host: "storm.test", ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const position = () => ({ lat: 35.22, lon: -97.44, heading: 45, speedKmh: 80, accuracyM: 10, until: Date.now() + 3_600_000 });

beforeEach(() => {
  session.user = null;
  vi.clearAllMocks();
});

describe("/api/chasers", () => {
  it("is for signed-in members only, never cached", async () => {
    expect((await GET()).status).toBe(401);
    session.user = member();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ chasers: [] });
  });

  it("refuses cross-site writes and signed-out writes", async () => {
    session.user = member();
    expect((await PUT(request("PUT", position(), "https://evil.test"))).status).toBe(403);
    expect((await DELETE(request("DELETE", undefined, ""))).status).toBe(403);
    session.user = null;
    expect((await PUT(request("PUT", position()))).status).toBe(401);
    expect(repo.upsertPosition).not.toHaveBeenCalled();
  });

  it("validates the position and the sharing window", async () => {
    session.user = member();
    expect((await PUT(request("PUT", { ...position(), lat: 123 }))).status).toBe(400);
    session.user = member();
    expect((await PUT(request("PUT", { ...position(), until: Date.now() - 1 }))).status).toBe(400);
    session.user = member();
    expect((await PUT(request("PUT", "nope"))).status).toBe(400);
    expect(repo.upsertPosition).not.toHaveBeenCalled();
  });

  it("saves a position, then rate-limits a quick second one", async () => {
    const me = member();
    session.user = me;
    const body = position();
    const res = await PUT(request("PUT", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expiresAt: body.until });
    expect(repo.upsertPosition).toHaveBeenCalledWith(me.id, body, expect.any(Number));
    expect((await PUT(request("PUT", position()))).status).toBe(429);
  });

  it("won't take a suspended account's position", async () => {
    session.user = member({ suspendedUntil: Date.now() + 60_000 });
    expect((await PUT(request("PUT", position()))).status).toBe(403);
  });

  it("deletes my position when I stop", async () => {
    const me = member();
    session.user = me;
    expect((await DELETE(request("DELETE"))).status).toBe(204);
    expect(repo.stopSharing).toHaveBeenCalledWith(me.id);
  });
});
