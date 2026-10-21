import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
const repo = vi.hoisted(() => ({
  findUserId: vi.fn(async (username: string) => `id-${username}`),
  keepContent: vi.fn(async () => {}),
  moderationQueue: vi.fn(async () => []),
  removeContent: vi.fn(async () => true),
  suspendUser: vi.fn(async () => Date.now() + 86_400_000),
  unsuspendUser: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/session")>()), getSessionUser: async () => session.user }));
vi.mock("@/lib/server/moderation-repo", () => repo);

const { GET, POST } = await import("./route");

const mod = (extra: Partial<SessionUser> = {}): SessionUser => ({ id: "id-mia", username: "mia", displayName: "Mia", avatarHue: 1, avatarUrl: null, moderator: true, suspendedUntil: null, ...extra });
const act = (body: unknown) =>
  POST(new Request("https://storm.test/api/moderation", { method: "POST", headers: { host: "storm.test", origin: "https://storm.test", "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  session.user = null;
  vi.clearAllMocks();
});

describe("/api/moderation", () => {
  it("lets moderators see the queue and lift a suspension", async () => {
    session.user = mod();
    expect((await GET()).status).toBe(200);
    expect((await act({ action: "unsuspend", username: "sam" })).status).toBe(200);
    expect(repo.unsuspendUser).toHaveBeenCalledWith("id-sam");
  });

  it("does nothing for a suspended moderator, who can't lift their own suspension", async () => {
    session.user = mod({ suspendedUntil: Date.now() + 86_400_000 });
    expect((await GET()).status).toBe(403);
    expect((await act({ action: "unsuspend", username: "mia" })).status).toBe(403);
    expect((await act({ action: "remove", type: "post", id: "p1" })).status).toBe(403);
    expect(repo.moderationQueue).not.toHaveBeenCalled();
    expect(repo.unsuspendUser).not.toHaveBeenCalled();
    expect(repo.removeContent).not.toHaveBeenCalled();
  });
});
