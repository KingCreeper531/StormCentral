import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/session";
import { trackPolygon } from "../warngen/geometry";
import type { IssueRequest } from "../warngen/schema";

// A throwaway database for the real repository code (getDb reads DATABASE_URL once).
const dir = mkdtempSync(path.join(tmpdir(), "sc-warngen-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;

type Repo = typeof import("./warngen-repo");
let r: Repo;

const user = (id: string, extra: Partial<SessionUser> = {}): SessionUser => ({ id, username: id.slice(2), displayName: id.slice(2), avatarHue: 1, avatarUrl: null, moderator: false, suspendedUntil: null, ...extra });
const ALICE = "u-alice";
const BOB = "u-bob";

beforeAll(async () => {
  r = await import("./warngen-repo");
  const { getDb } = await import("../db/client");
  const { users, posts, verifications } = await import("../db/schema");
  const db = await getDb();
  const now = Date.now();
  await db.insert(users).values([ALICE, BOB].map((id) => ({ id, username: id.slice(2), email: `${id}@x.io`, passwordHash: "h", displayName: id.slice(2), avatarHue: 1, createdAt: now })));
  // Alice's report confirmed by 3 people: reputation 3.
  await db.insert(posts).values({ id: "p1", userId: ALICE, body: "Hail", category: "hail", severity: 1, lat: 35, lon: -97, createdAt: now });
  for (const id of ["v1", "v2", "v3"]) {
    await db.insert(users).values({ id, username: id, email: `${id}@x.io`, passwordHash: "h", displayName: id, avatarHue: 1, createdAt: now });
    await db.insert(verifications).values({ postId: "p1", userId: id, createdAt: now });
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const request = (kind: IssueRequest["kind"] = "SVR"): IssueRequest => ({
  kind,
  polygon: trackPolygon({ lat: 35.22, lon: -97.44 }, { headingDeg: 45, speedKt: 30 }, 45),
  minutes: 45,
  storm: { lat: 35.22, lon: -97.44, t: Date.now() },
  motion: { headingDeg: 45, speedKt: 30 },
  basis: "radar",
  hail: 1.75,
  wind: 70,
  tornadoPossible: true,
  threat: "considerable",
  notes: null,
  place: "Norman, OK",
  locations: ["Norman", "Moore"],
});

describe("who may issue", () => {
  it("takes Trusted Spotter rank by default, or WARNGEN_MIN_REPUTATION", async () => {
    delete process.env.WARNGEN_MIN_REPUTATION;
    expect((await r.issuePermission(user(ALICE))).ok).toBe(false);
    expect((await r.issuePermission(user(ALICE))).reason).toContain("(you have 3)");
    process.env.WARNGEN_MIN_REPUTATION = "3";
    expect((await r.issuePermission(user(ALICE))).ok).toBe(true);
    expect((await r.issuePermission(user(BOB))).ok).toBe(false);
    expect((await r.issuePermission(user(BOB, { moderator: true }))).ok).toBe(true);
    expect((await r.issuePermission(user(ALICE, { suspendedUntil: Date.now() + 1000 }))).ok).toBe(false);
    delete process.env.WARNGEN_MIN_REPUTATION;
  });
});

describe("spotter warnings", () => {
  it("numbers, lists, updates and cancels", async () => {
    const id1 = await r.createWarning(ALICE, request("SVR"));
    const id2 = await r.createWarning(ALICE, request("TOR"));
    const mine = await r.listWarnings(ALICE);
    const theirs = await r.listWarnings(BOB);
    // Newest first.
    expect(mine.map((w) => w.id).filter((id) => id === id1 || id === id2)).toEqual([id2, id1]);
    const w1 = mine.find((w) => w.id === id1)!;
    const w2 = mine.find((w) => w.id === id2)!;
    expect(w2.number).toBe(w1.number + 1);
    expect(w1).toMatchObject({ kind: "SVR", status: "active", mine: true, hail: 1.75, wind: 70, tornadoPossible: true, threat: "considerable", place: "Norman, OK", locations: ["Norman", "Moore"], revision: 0 });
    expect(w1.polygon.length).toBe(5);
    expect(w1.issuer.username).toBe("alice");
    expect(theirs.find((w) => w.id === id1)?.mine).toBe(false);
    expect(await r.activeCount(ALICE)).toBe(2);

    await r.updateWarning(id1, { action: "update", ...request("SVR"), minutes: 30, wind: 80, threat: "destructive" });
    const updated = await r.getWarning(id1, ALICE);
    expect(updated).toMatchObject({ revision: 1, wind: 80, threat: "destructive" });
    expect(updated!.expiresAt - Date.now()).toBeLessThanOrEqual(30 * 60_000);

    await r.cancelWarning(id2);
    expect((await r.getWarning(id2, BOB))?.status).toBe("cancelled");
    expect(await r.activeCount(ALICE)).toBe(1);
  });

  it("hides a suspended spotter's warnings from everyone else", async () => {
    const { getDb } = await import("../db/client");
    const { users } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const id = await r.createWarning(BOB, request("TOR"));
    expect((await r.listWarnings(ALICE)).some((w) => w.id === id)).toBe(true);
    await (await getDb()).update(users).set({ suspendedUntil: Date.now() + 60_000 }).where(eq(users.id, BOB));
    expect((await r.listWarnings(ALICE)).some((w) => w.id === id)).toBe(false);
    expect((await r.listWarnings(BOB)).some((w) => w.id === id)).toBe(true);
  });
});
