import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StormReport } from "../feeds/storm-reports";

// A throwaway database for the real repository code (getDb reads DATABASE_URL once).
const dir = mkdtempSync(path.join(tmpdir(), "sc-community-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;

type Repo = typeof import("./community-repo");
type Sync = typeof import("./nws-sync");
let r: Repo;
let s: Sync;
const NOW = Date.now();

const report = (over: Partial<StormReport> = {}): StormReport => ({
  id: "lsr-1",
  time: new Date(NOW - 10 * 60_000).toISOString(),
  kind: "hail",
  typeText: "HAIL",
  magnitude: 1.75,
  unit: "INCH",
  measured: false,
  place: "3 N ENID",
  county: "Garfield",
  state: "OK",
  source: "TRAINED SPOTTER",
  remark: null,
  wfo: "OUN",
  lat: 36.44,
  lon: -97.88,
  ...over,
});

beforeAll(async () => {
  r = await import("./community-repo");
  s = await import("./nws-sync");
  const { getDb } = await import("../db/client");
  const { users, posts, verifications } = await import("../db/schema");
  const db = await getDb();
  for (const id of ["alice", "bob"]) await db.insert(users).values({ id, username: id, email: `${id}@x.io`, passwordHash: "h", displayName: id, avatarHue: 1, createdAt: NOW });
  const base = { userId: "alice", body: "Hail!", severity: 1, lat: 36.4, lon: -97.9 };
  await db.insert(posts).values([
    { ...base, id: "hail", category: "hail", createdAt: NOW - 5 * 60_000 },
    { ...base, id: "sky", category: "sky", createdAt: NOW - 5 * 60_000 },
    { ...base, id: "old", category: "hail", createdAt: NOW - 30 * 3_600_000 },
    { ...base, id: "hidden", category: "hail", createdAt: NOW - 5 * 60_000, hidden: 1 },
  ]);
  await db.insert(verifications).values({ postId: "hail", userId: "bob", createdAt: NOW });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("profile", () => {
  it("counts the person's reports and confirmations", async () => {
    const p = await r.getProfile("alice");
    expect(p?.posts).toBe(4);
    expect(p?.reputation).toBe(1);
    expect(p?.nwsConfirmed).toBe(0);
  });
});

describe("NWS confirmations", () => {
  it("confirms recent, visible reports that match an NWS storm report, once", async () => {
    const loadReports = async () => [report()];
    expect(await s.syncNwsConfirmations({ now: NOW, loadReports })).toBe(1);
    expect(await s.syncNwsConfirmations({ now: NOW + 60_000, loadReports })).toBe(0);
  });

  it("shows the match on the report and adds 5 to the author's reputation", async () => {
    const { posts } = await r.listPosts({ sort: "latest" }, null);
    const hail = posts.find((p) => p.id === "hail");
    expect(hail?.nws).toMatchObject({ id: "lsr-1", typeText: "HAIL", magnitude: 1.75, place: "3 N ENID" });
    expect(posts.find((p) => p.id === "sky")?.nws).toBeNull();
    expect(hail?.author.reputation).toBe(6);
    const profile = await r.getProfile("alice");
    expect(profile?.reputation).toBe(6);
    expect(profile?.nwsConfirmed).toBe(1);
  });

  it("tells the author through their activity", async () => {
    const items = await r.listActivity("alice", NOW - 60_000);
    expect(items.map((i) => i.kind).sort()).toEqual(["confirm", "nws"]);
    expect(items.find((i) => i.kind === "nws")).toMatchObject({ id: "n:hail", postId: "hail" });
  });

  it("only returns activity after `since`, so the newest item the app saw doesn't come back", async () => {
    // Bob's confirmation and the NWS match are both stamped NOW; apps then ask for what came after NOW.
    expect((await r.listActivity("alice", NOW - 1)).map((i) => i.kind).sort()).toEqual(["confirm", "nws"]);
    expect(await r.listActivity("alice", NOW)).toEqual([]);
  });
});

describe("threads", () => {
  beforeAll(async () => {
    const { getDb } = await import("../db/client");
    const { blocks, comments, posts, users } = await import("../db/schema");
    const db = await getDb();
    for (const [id, suspendedUntil] of [["carl", null], ["sam", NOW + 86_400_000]] as const)
      await db.insert(users).values({ id, username: id, email: `${id}@x.io`, passwordHash: "h", displayName: id, avatarHue: 1, createdAt: NOW, suspendedUntil });
    const base = { body: "Wall cloud", category: "sky", severity: 1, lat: 36.4, lon: -97.9, createdAt: NOW - 60 * 60_000 };
    await db.insert(posts).values([
      { ...base, id: "thread", userId: "bob" },
      { ...base, id: "sam-post", userId: "sam" },
    ]);
    await db.insert(comments).values(Array.from({ length: 205 }, (_, i) => ({ id: `c${String(i).padStart(3, "0")}`, postId: "thread", userId: "alice", body: `#${i}`, createdAt: NOW - 50 * 60_000 + i })));
    await db.insert(blocks).values({ blockerId: "carl", blockedId: "bob", createdAt: NOW });
  });

  it("shows a long thread's newest 200 comments, oldest first", async () => {
    const list = await r.listComments("thread", null);
    expect(list).toHaveLength(200);
    expect(list[0]!.body).toBe("#5");
    expect(list.at(-1)!.body).toBe("#204");
  });

  it("finds a report only for people the feeds would show it to", async () => {
    expect(await r.getVisiblePost("hail", null)).toEqual({ userId: "alice" });
    expect(await r.getVisiblePost("nope", null)).toBeNull();
    // Hidden for review: only its author.
    expect(await r.getVisiblePost("hidden", null)).toBeNull();
    expect(await r.getVisiblePost("hidden", "bob", true)).toBeNull();
    expect(await r.getVisiblePost("hidden", "alice")).toEqual({ userId: "alice" });
    // A suspended account's: its owner and moderators.
    expect(await r.getVisiblePost("sam-post", "bob")).toBeNull();
    expect(await r.getVisiblePost("sam-post", "sam")).toEqual({ userId: "sam" });
    expect(await r.getVisiblePost("sam-post", "bob", true)).toEqual({ userId: "sam" });
    // Blocked either way.
    expect(await r.getVisiblePost("thread", "carl")).toBeNull();
    expect(await r.getVisiblePost("thread", "alice")).toEqual({ userId: "bob" });
  });
});
