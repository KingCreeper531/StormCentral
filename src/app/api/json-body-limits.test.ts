import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { MAX_JSON_BYTES } from "@/lib/server/body";

/**
 * Every route that takes a JSON body reads it with readJson's size cap: an
 * oversized body is refused with 413 before it's parsed, and nothing is written.
 */
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
const writes = vi.hoisted(() => ({ count: 0 }));
const write = vi.hoisted(() => async () => {
  writes.count++;
});

vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  getSessionUser: async () => session.user,
  createSession: write,
  destroySession: write,
}));
vi.mock("@/lib/db/client", () => ({
  getDb: async () => {
    writes.count++;
    throw new Error("the database isn't reached for an oversized body");
  },
}));
vi.mock("@/lib/server/warngen-repo", () => ({
  issuePermission: async () => ({ ok: true }),
  getWarning: async () => ({ status: "active", kind: "tornado" }),
  activeCount: async () => 0,
  createWarning: write,
  updateWarning: write,
  cancelWarning: write,
  listWarnings: async () => [],
  MAX_ACTIVE_PER_USER: 3,
}));
vi.mock("@/lib/server/community-repo", () => ({ getVisiblePost: async () => ({ id: "p1" }), addComment: write, listComments: async () => [] }));
vi.mock("@/lib/server/chaser-repo", () => ({ upsertPosition: write, stopSharing: write, listChasers: async () => [], pruneChasers: write }));
vi.mock("@/lib/server/live-drawing-repo", () => ({ getLiveDrawing: async () => ({ shapes: [] }), setLiveDrawing: write }));
vi.mock("@/lib/server/moderation-repo", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(real).map((k) => [k, typeof real[k] === "function" ? write : real[k]]));
});
vi.mock("@/lib/server/roles-repo", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(real).map((k) => [k, typeof real[k] === "function" ? write : real[k]]));
});

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const ctx = { params: Promise.resolve({ id: "x1" }) };

let n = 0;
const moderator = (): SessionUser => ({ id: `m${++n}`, username: `mod${n}`, displayName: "Mod", avatarHue: 1, avatarUrl: null, moderator: true, suspendedUntil: null });

const routes: [string, string, () => Promise<Handler>][] = [
  ["auth/password", "POST", async () => (await import("./auth/password/route")).POST as Handler],
  ["account", "PATCH", async () => (await import("./account/route")).PATCH as Handler],
  ["account", "DELETE", async () => (await import("./account/route")).DELETE as Handler],
  ["moderation", "POST", async () => (await import("./moderation/route")).POST as Handler],
  ["moderation/roles", "POST", async () => (await import("./moderation/roles/route")).POST as Handler],
  ["spotter-warnings", "POST", async () => (await import("./spotter-warnings/route")).POST as Handler],
  ["spotter-warnings/x1", "PATCH", async () => (await import("./spotter-warnings/[id]/route")).PATCH as Handler],
  ["chasers", "PUT", async () => (await import("./chasers/route")).PUT as Handler],
  ["posts/x1/comments", "POST", async () => (await import("./posts/[id]/comments/route")).POST as Handler],
  ["blocks", "POST", async () => (await import("./blocks/route")).POST as Handler],
  ["blocks", "DELETE", async () => (await import("./blocks/route")).DELETE as Handler],
  ["flags", "POST", async () => (await import("./flags/route")).POST as Handler],
];

const request = (path: string, method: string, body: string, contentLength = true) =>
  new Request(`https://storm.test/api/${path}`, {
    method,
    headers: { host: "storm.test", origin: "https://storm.test", "content-type": "application/json", ...(contentLength ? { "content-length": String(body.length) } : {}) },
    body,
  });

/** Valid JSON, just too big: a string field padded past the cap. */
const big = (bytes: number) => JSON.stringify({ username: "someone", details: "x".repeat(bytes) });

beforeEach(() => {
  session.user = moderator();
  writes.count = 0;
});

describe("JSON bodies are size-capped", () => {
  it.each(routes)("/api/%s %s refuses an oversized body with 413", async (path, method, load) => {
    const handler = await load();
    const res = await handler(request(path, method, big(MAX_JSON_BYTES)), ctx);
    expect(res.status).toBe(413);
    expect(writes.count).toBe(0);
  });

  it.each(routes)("/api/%s %s counts a body with no Content-Length as it arrives", async (path, method, load) => {
    const handler = await load();
    const res = await handler(request(path, method, big(MAX_JSON_BYTES), false), ctx);
    expect(res.status).toBe(413);
    expect(writes.count).toBe(0);
  });

  it("gives live drawing room for the biggest drawing it keeps, and still caps it", async () => {
    const { PUT } = await import("./live-drawing/route");
    // 200 pen strokes of 800 points at full precision: the most cleanShapes keeps, as the draw store sends it.
    const pt = [-97.123456789012, 35.123456789012];
    const shapes = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, kind: "pen", color: "#ff3b30", width: 3, points: Array.from({ length: 800 }, () => pt) }));
    const body = JSON.stringify({ shapes });
    expect(body.length).toBeGreaterThan(MAX_JSON_BYTES);
    expect((await PUT(request("live-drawing", "PUT", body))).status).toBe(200);
    expect((await PUT(request("live-drawing", "PUT", JSON.stringify({ shapes: [], pad: "x".repeat(8 * 1024 * 1024) })))).status).toBe(413);
  });
});
