import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
const repo = vi.hoisted(() => ({
  // Only "open" is a report the viewer can see; the rest are hidden, from a suspended account, blocked or gone.
  getVisiblePost: vi.fn(async (id: string) => (id === "open" ? { userId: "author" } : null)),
  listComments: vi.fn(async () => []),
  addComment: vi.fn(async () => "c1"),
  toggleVerification: vi.fn(async () => ({ verified: true, count: 1 })),
}));
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/session")>()), getSessionUser: async () => session.user }));
vi.mock("@/lib/server/community-repo", () => repo);

const comments = await import("./route");
const verify = await import("../verify/route");

const member = (): SessionUser => ({ id: "viewer", username: "vic", displayName: "Vic", avatarHue: 1, avatarUrl: null, moderator: false, suspendedUntil: null });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new Request("https://storm.test/api/posts/x", { method: "POST", headers: { host: "storm.test", origin: "https://storm.test", "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

beforeEach(() => {
  session.user = null;
  vi.clearAllMocks();
});

describe("a report's comments and confirmations", () => {
  it("only for reports the viewer can see", async () => {
    expect((await comments.GET(new Request("https://storm.test"), ctx("open"))).status).toBe(200);
    expect((await comments.GET(new Request("https://storm.test"), ctx("hidden"))).status).toBe(404);
    expect(repo.listComments).toHaveBeenCalledTimes(1);

    session.user = member();
    expect((await comments.POST(post({ body: "Nice shot" }), ctx("hidden"))).status).toBe(404);
    expect((await verify.POST(post(), ctx("hidden"))).status).toBe(404);
    expect(repo.addComment).not.toHaveBeenCalled();
    expect(repo.toggleVerification).not.toHaveBeenCalled();
    expect(repo.getVisiblePost).toHaveBeenLastCalledWith("hidden", "viewer", false);

    expect((await comments.POST(post({ body: "Nice shot" }), ctx("open"))).status).toBe(201);
    expect((await verify.POST(post(), ctx("open"))).status).toBe(200);
  });
});
