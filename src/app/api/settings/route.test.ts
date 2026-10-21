import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
const repo = vi.hoisted(() => ({
  getSettings: vi.fn<(userId: string) => Promise<unknown>>(async () => null),
  putSettings: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true })),
  deleteSettings: vi.fn<(userId: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/session")>()), getSessionUser: async () => session.user }));
vi.mock("@/lib/server/settings-repo", () => repo);

const { DELETE, GET, PUT } = await import("./route");

let n = 0;
const member = (): SessionUser => ({ id: `u${++n}`, username: `user${n}`, displayName: "User", avatarHue: 1, avatarUrl: null, moderator: false, suspendedUntil: null });
const request = (method: string, body?: unknown, origin = "https://storm.test") =>
  new Request("https://storm.test/api/settings", {
    method,
    headers: { host: "storm.test", ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const data = { v: 1, sections: { app: { theme: "dark" } } };

beforeEach(() => {
  session.user = null;
  vi.clearAllMocks();
});

describe("/api/settings", () => {
  it("needs a signed-in account, and isn't cached", async () => {
    expect((await GET()).status).toBe(401);
    expect((await PUT(request("PUT", { data, changedAt: 1 }))).status).toBe(401);
    session.user = member();
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ data: null, changedAt: 0 });
    expect(repo.getSettings).toHaveBeenCalledWith(session.user.id);
  });

  it("keeps checked settings, stamped no later than a little ahead of now", async () => {
    session.user = member();
    const at = Date.now();
    const res = await PUT(request("PUT", { data: { ...data, sections: { ...data.sections, evil: {} } }, changedAt: at }));
    expect(res.status).toBe(200);
    expect(repo.putSettings).toHaveBeenCalledWith(session.user.id, data, at, expect.any(Number));
    await PUT(request("PUT", { data, changedAt: at + 365 * 86_400_000 }));
    expect(repo.putSettings.mock.calls[1]![2]).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });

  it("answers 409 with the account's settings when another device changed them later", async () => {
    session.user = member();
    const current = { data: { v: 1, sections: { app: { theme: "light" } } }, changedAt: 99 };
    repo.putSettings.mockResolvedValueOnce({ ok: false, current });
    const res = await PUT(request("PUT", { data, changedAt: 50 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(current);
  });

  it("refuses other sites, bad bodies and oversized settings", async () => {
    session.user = member();
    expect((await PUT(request("PUT", { data, changedAt: 1 }, "https://evil.test"))).status).toBe(403);
    expect((await PUT(request("PUT", { data, changedAt: "soon" }))).status).toBe(400);
    expect((await PUT(request("PUT", { data: { v: 9 }, changedAt: 1 }))).status).toBe(400);
    expect((await PUT(request("PUT", "{not json"))).status).toBe(400);
    expect((await PUT(request("PUT", { data: { v: 1, sections: { app: { x: "y".repeat(200_000) } } }, changedAt: 1 }))).status).toBe(413);
    expect(repo.putSettings).not.toHaveBeenCalled();
  });

  it("forgets them on DELETE", async () => {
    session.user = member();
    expect((await DELETE(request("DELETE"))).status).toBe(204);
    expect(repo.deleteSettings).toHaveBeenCalledWith(session.user.id);
  });
});
