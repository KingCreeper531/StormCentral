import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { decrypt, dumpSql, encrypt, literal, quoteIdent, type Table } from "./backup-db";

describe("database backup", () => {
  it("writes SQL literals safely", () => {
    expect(literal(null)).toBe("NULL");
    expect(literal(42)).toBe("42");
    expect(literal("it's")).toBe("'it''s'");
    expect(literal(new Uint8Array([0xde, 0xad]))).toBe("X'dead'");
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });

  it("encrypts so only the passphrase opens it", () => {
    const sealed = encrypt(Buffer.from("SELECT 1;"), "correct horse");
    expect(sealed.includes(Buffer.from("SELECT"))).toBe(false);
    expect(decrypt(sealed, "correct horse").toString()).toBe("SELECT 1;");
    expect(() => decrypt(sealed, "wrong")).toThrow(/Wrong passphrase/);
    expect(() => decrypt(Buffer.from("nope"), "x")).toThrow(/Not a Storm Central backup/);
  });

  it("restores into an empty database exactly as it was", async () => {
    const src = createClient({ url: ":memory:" });
    await src.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT, avatar BLOB)");
    await src.execute("CREATE INDEX users_name ON users (name)");
    await src.execute({ sql: "INSERT INTO users VALUES (1, ?, ?, ?), (2, ?, NULL, NULL)", args: ["O'Brien", "storm 'chaser'\nline two", new Uint8Array([1, 2, 3]), "Kim"] });
    const res = await src.execute("SELECT * FROM users");
    const tables: Table[] = [{ name: "users", sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT, avatar BLOB)", columns: res.columns, rows: res.rows.map((r) => res.columns.map((c) => r[c] as never)) }];
    const sql = decrypt(encrypt(Buffer.from(dumpSql(tables, ["CREATE INDEX users_name ON users (name)"])), "p"), "p").toString();
    const dst = createClient({ url: ":memory:" });
    await dst.executeMultiple(sql);
    const back = await dst.execute("SELECT id, name, bio, hex(avatar) AS a FROM users ORDER BY id");
    expect(back.rows.map((r) => [r.id, r.name, r.bio, r.a])).toEqual([
      [1, "O'Brien", "storm 'chaser'\nline two", "010203"],
      [2, "Kim", null, ""],
    ]);
    expect((await dst.execute("SELECT name FROM sqlite_master WHERE type='index'")).rows.map((r) => r.name)).toContain("users_name");
  });
});
