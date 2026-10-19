import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PositionInput } from "../chasers";

// A throwaway database for the real repository code (getDb reads DATABASE_URL once).
const dir = mkdtempSync(path.join(tmpdir(), "sc-chasers-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;

type Repo = typeof import("./chaser-repo");
let r: Repo;

const ALICE = "u-alice";
const BOB = "u-bob";
const CARL = "u-carl";
const DANA = "u-dana";
const T0 = Date.now();
const HOUR = 3_600_000;

const at = (lat: number, lon: number, extra: Partial<PositionInput> = {}): PositionInput => ({ lat, lon, heading: 90, speedKmh: 88, accuracyM: 8, until: T0 + 4 * HOUR, ...extra });

beforeAll(async () => {
  r = await import("./chaser-repo");
  const { getDb } = await import("../db/client");
  const { blocks, users } = await import("../db/schema");
  const db = await getDb();
  await db.insert(users).values(
    [ALICE, BOB, CARL, DANA].map((id) => ({
      id,
      username: id.slice(2),
      email: `${id}@x.io`,
      passwordHash: "h",
      displayName: id.slice(2),
      avatarHue: 1,
      createdAt: T0,
      // Dana is suspended.
      suspendedUntil: id === DANA ? T0 + 24 * HOUR : null,
    })),
  );
  // Alice blocked Carl.
  await db.insert(blocks).values({ blockerId: ALICE, blockedId: CARL, createdAt: T0 });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("chaser positions", () => {
  it("keeps one rounded position per person, updated in place", async () => {
    await r.upsertPosition(BOB, at(35.123456, -97.654321), T0);
    await r.upsertPosition(BOB, at(35.2, -97.5, { heading: 181.6 }), T0 + 60_000);
    const list = await r.listChasers(ALICE, T0 + 60_000);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ username: "bob", lat: 35.2, lon: -97.5, heading: 182, speedKmh: 88, ageSec: 0, mine: false, developer: false, trusted: false, reputation: 0 });
    await r.upsertPosition(BOB, at(35.123456, -97.654321), T0 + 120_000);
    expect((await r.listChasers(ALICE, T0 + 120_000))[0]).toMatchObject({ lat: 35.1235, lon: -97.6543 });
  });

  it("caps the sharing window at 12 hours", async () => {
    expect(await r.upsertPosition(ALICE, at(35, -97, { until: T0 + 48 * HOUR }), T0)).toBe(T0 + 12 * HOUR);
    expect(await r.upsertPosition(ALICE, at(35, -97, { until: T0 + HOUR }), T0)).toBe(T0 + HOUR);
  });

  it("shows my own position, flagged as mine", async () => {
    const mine = (await r.listChasers(ALICE, T0)).find((c) => c.username === "alice");
    expect(mine?.mine).toBe(true);
  });

  it("drops positions that went stale or whose window ended", async () => {
    const names = async (now: number) => (await r.listChasers(ALICE, now)).map((c) => c.username).sort();
    await r.upsertPosition(ALICE, at(35, -97, { until: T0 + 30 * 60_000 }), T0 + 10 * 60_000);
    // Bob last sent at T0 + 2 min: gone just over 15 minutes later.
    expect(await names(T0 + 17.5 * 60_000)).toEqual(["alice"]);
    // Alice's window ends at T0 + 30 min, though she sent recently.
    await r.upsertPosition(ALICE, at(35, -97, { until: T0 + 30 * 60_000 }), T0 + 25 * 60_000);
    expect(await names(T0 + 31 * 60_000)).toEqual([]);
  });

  it("leaves out blocked people (both ways) and suspended accounts, except to themselves", async () => {
    const now = T0 + 40 * 60_000;
    for (const id of [ALICE, BOB, CARL, DANA]) await r.upsertPosition(id, at(35, -97, { until: now + HOUR }), now);
    const seen = async (viewer: string) => (await r.listChasers(viewer, now)).map((c) => c.username).sort();
    expect(await seen(ALICE)).toEqual(["alice", "bob"]);
    expect(await seen(CARL)).toEqual(["bob", "carl"]);
    expect(await seen(DANA)).toEqual(["alice", "bob", "carl", "dana"]);
  });

  it("deletes the position when sharing stops, and prunes old rows", async () => {
    const now = T0 + 40 * 60_000;
    await r.stopSharing(BOB);
    expect((await r.listChasers(ALICE, now)).map((c) => c.username)).toEqual(["alice"]);
    await r.pruneChasers(now + 2 * HOUR);
    const { getDb } = await import("../db/client");
    const { chaserPositions } = await import("../db/schema");
    expect(await (await getDb()).select().from(chaserPositions)).toEqual([]);
  });
});
