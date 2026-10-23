import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/session";

// A throwaway database for the real repository code (getDb reads DATABASE_URL once).
const dir = mkdtempSync(path.join(tmpdir(), "sc-roles-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;

type Repo = typeof import("./roles-repo");
let r: Repo;

const viewer = (id: string, username: string, moderator = true): SessionUser => ({ id, username, displayName: username, avatarHue: 1, avatarUrl: null, moderator, suspendedUntil: null });

beforeAll(async () => {
  r = await import("./roles-repo");
  const { getDb } = await import("../db/client");
  const { users } = await import("../db/schema");
  const db = await getDb();
  const now = Date.now();
  await db.insert(users).values(["boss", "appointed", "kim", "lee"].map((u) => ({ id: `u-${u}`, username: u, email: `${u}@x.io`, passwordHash: "h", displayName: u, avatarHue: 1, createdAt: now })));
});

describe("roles given in the app", () => {
  it("lets any moderator give Trusted Spotter, and only MODERATORS give WarnGen or Moderator", () => {
    process.env.MODERATORS = "boss";
    const boss = viewer("u-boss", "boss");
    const appointed = viewer("u-appointed", "appointed");
    expect(["trusted", "warngen", "moderator"].map((role) => r.canChangeRole(boss, role as never))).toEqual([true, true, true]);
    expect(["trusted", "warngen", "moderator"].map((role) => r.canChangeRole(appointed, role as never))).toEqual([true, false, false]);
    expect(r.canChangeRole(viewer("u-kim", "kim", false), "trusted")).toBe(false);
    delete process.env.MODERATORS;
  });

  it("gives and takes away a role, recording who gave it, and badges follow", async () => {
    await r.setRole("u-kim", "trusted", true, "u-boss");
    await r.setRole("u-kim", "trusted", true, "u-boss"); // twice is the same as once
    expect(await r.rolesOf("u-kim")).toEqual(new Set(["trusted"]));
    const granted = await r.grantedTrusted();
    expect(r.isTrusted("Kim", granted)).toBe(true);
    expect(r.isTrusted("lee", granted)).toBe(false);
    expect(await r.listGranted()).toMatchObject([{ username: "kim", role: "trusted", by: "boss" }]);

    await r.setRole("u-kim", "trusted", false, "u-boss");
    expect(await r.rolesOf("u-kim")).toEqual(new Set());
    expect(r.isTrusted("kim", await r.grantedTrusted())).toBe(false);
  });

  it("shows an account's roles, and never lets you change your own", async () => {
    process.env.MODERATORS = "boss";
    await r.setRole("u-lee", "warngen", true, "u-boss");
    const info = await r.roleInfo("lee", viewer("u-boss", "boss"));
    expect(info).toMatchObject({ username: "lee", builtIn: { moderator: false, warngen: false }, granted: [{ role: "warngen", by: "boss" }], canChange: { trusted: true, warngen: true, moderator: true } });
    const own = await r.roleInfo("boss", viewer("u-boss", "boss"));
    expect(own?.builtIn.moderator).toBe(true);
    expect(own?.canChange).toEqual({ trusted: false, warngen: false, moderator: false });
    expect(await r.roleInfo("nobody", viewer("u-boss", "boss"))).toBeNull();
    delete process.env.MODERATORS;
  });
});
