import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, describe, expect, it } from "vitest";
import { comments, media, passwordResets, posts, SCHEMA_SQL, schema, sessions, users, verifications } from "./schema";

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

    const [m] = await db.select().from(media).where(eq(media.id, "m1"));
    expect(Buffer.from(m!.bytes)).toEqual(Buffer.from([1, 2, 3]));
    const [v] = await db.select().from(verifications).where(and(eq(verifications.postId, "p1"), eq(verifications.userId, "u1")));
    expect(v).toBeDefined();
    const [u] = await db.select().from(users).where(eq(users.username, "ALICE"));
    expect(u?.id).toBe("u1");
    client.close();
  });
});
