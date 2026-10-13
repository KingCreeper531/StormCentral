import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A throwaway database for the real repository code (getDb reads DATABASE_URL once).
const dir = mkdtempSync(path.join(tmpdir(), "sc-mod-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;

type Community = typeof import("./community-repo");
type Moderation = typeof import("./moderation-repo");
let c: Community;
let m: Moderation;

const ALICE = "u-alice";
const BOB = "u-bob";
const CARL = "u-carl";
const DANA = "u-dana";

beforeAll(async () => {
  c = await import("./community-repo");
  m = await import("./moderation-repo");
  const { getDb } = await import("../db/client");
  const { users } = await import("../db/schema");
  const db = await getDb();
  const now = Date.now();
  await db.insert(users).values(
    [ALICE, BOB, CARL, DANA].map((id) => ({ id, username: id.slice(2), email: `${id}@x.io`, passwordHash: "h", displayName: id.slice(2), avatarHue: 1, createdAt: now })),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const post = (userId: string, body = "Quarter-size hail") =>
  c.createPost({ userId, body, category: "hail", severity: 1, lat: 35.2, lon: -97.4, conditions: null, image: null });
const feedIds = async (viewer: string | null) => (await c.listPosts({ sort: "latest" }, viewer)).posts.map((p) => p.id);

describe("blocking", () => {
  it("hides each person's reports and comments from the other, both ways", async () => {
    const p = await post(ALICE);
    const comment = await c.addComment(p, BOB, "Seeing it too");
    await m.block(ALICE, BOB);

    expect(await feedIds(BOB)).not.toContain(p); // the blocked person can't see the blocker
    expect(await feedIds(ALICE)).toContain(p);
    expect((await c.listComments(p, ALICE)).map((x) => x.id)).not.toContain(comment); // and the blocker doesn't see them
    expect((await c.listComments(p, CARL)).map((x) => x.id)).toContain(comment); // everyone else does
    expect((await c.listPosts({ sort: "latest" }, ALICE)).posts.find((x) => x.id === p)?.comments).toBe(0);
    expect(await m.blockedBetween(BOB, ALICE)).toBe(true);
    expect(await m.isBlocking(BOB, ALICE)).toBe(false);
    expect((await m.listBlocked(ALICE)).map((b) => b.username)).toEqual(["bob"]);

    await m.unblock(ALICE, BOB);
    expect(await feedIds(BOB)).toContain(p);
    expect(await m.blockedBetween(ALICE, BOB)).toBe(false);
  });
});

describe("flags", () => {
  it("hides a report after enough different people flag it, except from its author", async () => {
    const p = await post(DANA, "Totally real tornado");
    expect(await m.createFlag(DANA, { type: "post", id: p, reason: "spam" })).toMatchObject({ ok: false, status: 400 }); // not your own

    expect(await m.createFlag(ALICE, { type: "post", id: p, reason: "misleading" })).toEqual({ ok: true, hidden: false });
    expect(await m.createFlag(ALICE, { type: "post", id: p, reason: "spam" })).toEqual({ ok: true, hidden: false }); // repeats don't count
    expect(await m.createFlag(BOB, { type: "post", id: p, reason: "misleading" })).toEqual({ ok: true, hidden: false });
    expect(await m.createFlag(CARL, { type: "post", id: p, reason: "misleading", details: "Clear skies here" })).toEqual({ ok: true, hidden: true });

    expect(await feedIds(null)).not.toContain(p);
    expect(await feedIds(ALICE)).not.toContain(p);
    const own = (await c.listPosts({ sort: "latest" }, DANA)).posts.find((x) => x.id === p);
    expect(own?.hidden).toBe(true);

    const queue = await m.moderationQueue();
    const item = queue.find((i) => i.type === "post" && i.id === p);
    expect(item).toMatchObject({ hidden: true, body: "Totally real tornado", author: { username: "dana" } });
    expect(item?.flags).toHaveLength(3);

    await m.keepContent("post", p);
    expect(await feedIds(null)).toContain(p);
    expect((await m.moderationQueue()).some((i) => i.id === p)).toBe(false);
  });

  it("removes a report with its flags, and flags an account by id", async () => {
    const p = await post(DANA, "Spam spam spam");
    await m.createFlag(ALICE, { type: "post", id: p, reason: "spam" });
    expect(await m.removeContent("post", p)).toBe(true);
    expect(await feedIds(null)).not.toContain(p);
    expect((await m.moderationQueue()).some((i) => i.id === p)).toBe(false);

    expect(await m.createFlag(ALICE, { type: "user", id: "dana", reason: "harassment" })).toEqual({ ok: true, hidden: false });
    expect((await m.moderationQueue()).find((i) => i.type === "user")).toMatchObject({ id: DANA, author: { username: "dana" } });
    expect(await m.createFlag(ALICE, { type: "post", id: "missing", reason: "spam" })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("suspensions", () => {
  it("hides a suspended account's reports from others until lifted, and closes flags against it", async () => {
    const p = await post(CARL, "Funnel cloud");
    const until = await m.suspendUser(CARL, 7);
    expect(until).toBeGreaterThan(Date.now());
    expect(await feedIds(ALICE)).not.toContain(p);
    expect(await feedIds(CARL)).toContain(p); // still visible to themselves
    expect((await c.getProfile("carl"))?.suspendedUntil).toBe(until);

    await m.suspendUser(DANA, 0);
    expect((await m.moderationQueue()).some((i) => i.type === "user" && i.id === DANA)).toBe(false);

    await m.unsuspendUser(CARL);
    expect(await feedIds(ALICE)).toContain(p);
    expect((await c.getProfile("carl"))?.suspendedUntil).toBeNull();
  });
});
