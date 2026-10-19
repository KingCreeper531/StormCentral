import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, describe, expect, it } from "vitest";
import { blocks, comments, flags, media, passwordResets, posts, SCHEMA_SQL, schema, sessions, spotterWarnings, users, verifications } from "./schema";

const dir = mkdtempSync(path.join(tmpdir(), "sc-db-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("schema drift", () => {
  it("lets Drizzle read/write every table created from SCHEMA_SQL", async () => {
    const client = createClient({ url: `file:${path.join(dir, "t.db")}` });
    await client.executeMultiple(SCHEMA_SQL);
    await client.executeMultiple(SCHEMA_SQL); // idempotent
    const db = drizzle(client, { schema });
    const now = Date.now();

    await db.insert(users).values({ id: "u1", username: "Alice", email: "a@x.io", passwordHash: "h", displayName: "Alice", avatarHue: 200, createdAt: now });
    await expect(
      db.insert(users).values({ id: "u2", username: "alice", email: "b@x.io", passwordHash: "h", displayName: "A2", avatarHue: 1, createdAt: now }),
    ).rejects.toThrow(); // usernames are case-insensitively unique

    await db.insert(sessions).values({ id: "s1", userId: "u1", expiresAt: now + 1000, createdAt: now });
    await db.insert(passwordResets).values({ id: "r1", userId: "u1", expiresAt: now + 1000, createdAt: now });
    await db.insert(media).values({ id: "m1", userId: "u1", mime: "image/webp", width: 10, height: 10, size: 3, bytes: Buffer.from([1, 2, 3]), createdAt: now });
    await db.insert(posts).values({ id: "p1", userId: "u1", body: "Hail!", category: "hail", severity: 2, lat: 35.2, lon: -97.4, mediaId: "m1", createdAt: now });
    await db.insert(verifications).values({ postId: "p1", userId: "u1", createdAt: now });
    await db.insert(comments).values({ id: "c1", postId: "p1", userId: "u1", body: "Confirmed", createdAt: now });
    await db.insert(users).values({ id: "u3", username: "Bob", email: "c@x.io", passwordHash: "h", displayName: "Bob", avatarHue: 3, createdAt: now, suspendedUntil: now + 1000 });
    await db.insert(blocks).values({ blockerId: "u1", blockedId: "u3", createdAt: now });
    await db.insert(flags).values({ id: "f1", reporterId: "u3", targetType: "post", targetId: "p1", reason: "spam", createdAt: now });
    await expect(db.insert(flags).values({ id: "f2", reporterId: "u3", targetType: "post", targetId: "p1", reason: "hate", createdAt: now })).rejects.toThrow(); // one flag per person per target

    const ring = JSON.stringify([[-97.5, 35.1], [-97.2, 35.1], [-97.2, 35.4], [-97.5, 35.1]]);
    const warning = { userId: "u1", year: 2026, kind: "TOR", polygon: ring, west: -97.5, south: 35.1, east: -97.2, north: 35.4, issuedAt: now, updatedAt: now, expiresAt: now + 1_800_000, basis: "radar" };
    await db.insert(spotterWarnings).values({ id: "w1", number: 1, ...warning });
    await expect(db.insert(spotterWarnings).values({ id: "w2", number: 1, ...warning })).rejects.toThrow(); // numbers are unique per year
    const [w] = await db.select().from(spotterWarnings).where(eq(spotterWarnings.id, "w1"));
    expect(w?.revision).toBe(0);
    expect(w?.threat).toBe("base");
    expect(w?.cancelledAt).toBeNull();

    const [m] = await db.select().from(media).where(eq(media.id, "m1"));
    expect(Buffer.from(m!.bytes)).toEqual(Buffer.from([1, 2, 3]));
    const [v] = await db.select().from(verifications).where(and(eq(verifications.postId, "p1"), eq(verifications.userId, "u1")));
    expect(v).toBeDefined();
    const [u] = await db.select().from(users).where(eq(users.username, "ALICE"));
    expect(u?.id).toBe("u1");
    expect(u?.suspendedUntil).toBeNull();
    const [p] = await db.select().from(posts).where(eq(posts.id, "p1"));
    expect(p?.hidden).toBe(0); // defaults to visible
    const [f] = await db.select().from(flags).where(eq(flags.id, "f1"));
    expect(f?.status).toBe("open");
    expect(await db.select().from(blocks)).toHaveLength(1);
    client.close();
  });
});
