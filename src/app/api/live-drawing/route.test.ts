import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
const repo = vi.hoisted(() => ({
  getLiveDrawing: vi.fn(async () => ({ shapes: [], updatedAt: null })),
  setLiveDrawing: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/session")>()), getSessionUser: async () => session.user }));
vi.mock("@/lib/server/live-drawing-repo", () => repo);

const { DELETE, GET, PUT } = await import("./route");

let n = 0;
const member = (extra: Partial<SessionUser> = {}): SessionUser => ({ id: `u${++n}`, username: `user${n}`, displayName: "User", avatarHue: 1, avatarUrl: null, moderator: false, suspendedUntil: null, ...extra });
const request = (method: string, body?: unknown, origin = "https://storm.test") =>
  new Request("https://storm.test/api/live-drawing", {
    method,
    headers: { host: "storm.test", ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const arrow = { id: "a1", kind: "arrow", color: "#ff3b3b", width: 3, points: [[-97.5, 35.2], [-97.3, 35.3]] };

beforeEach(() => {
  session.user = null;
  vi.clearAllMocks();
});

describe("/api/live-drawing", () => {
  it("is public to read, never cached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("lets only moderators and developers draw on air", async () => {
    expect((await PUT(request("PUT", { shapes: [arrow] }))).status).toBe(401);
    session.user = member();
    expect((await PUT(request("PUT", { shapes: [arrow] }))).status).toBe(403);
    session.user = member({ moderator: true, suspendedUntil: Date.now() + 60_000 });
    expect((await PUT(request("PUT", { shapes: [arrow] }))).status).toBe(403);
    session.user = member({ username: "StormCentral_Official" });
    const res = await PUT(request("PUT", { shapes: [arrow, { kind: "nope" }] }));
    expect(res.status).toBe(200);
    expect(repo.setLiveDrawing).toHaveBeenCalledWith(session.user.id, [arrow]);
  });

  it("refuses other sites and bad bodies, and clears on DELETE", async () => {
    session.user = member({ moderator: true });
    expect((await PUT(request("PUT", { shapes: [arrow] }, "https://evil.test"))).status).toBe(403);
    expect((await PUT(request("PUT", { nope: 1 }))).status).toBe(400);
    expect((await DELETE(request("DELETE"))).status).toBe(204);
    expect(repo.setLiveDrawing).toHaveBeenLastCalledWith(session.user.id, []);
  });
});
