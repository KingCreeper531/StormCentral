/**
 * Nightly backup of Storm Central's database (accounts, spotter reports,
 * synced settings): .github/workflows/backup.yml runs it and keeps the file
 * as an artifact for 30 days.
 *
 *   node backup-db.mjs                     dump DATABASE_URL (+ DATABASE_AUTH_TOKEN) to BACKUP_OUT (default backup.sql.gz.enc)
 *   node backup-db.mjs decrypt FILE [OUT]  turn a backup back into plain SQL (default OUT: FILE without .gz.enc)
 *
 * The dump is plain SQL (the schema, then INSERTs), gzipped and encrypted
 * with AES-256-GCM under a key derived (scrypt) from BACKUP_PASSPHRASE, so a
 * leaked artifact is useless without the passphrase. Restore: decrypt, then
 * `turso db shell <db> < backup.sql` (or sqlite3 for a local copy).
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = Buffer.from("SCBK1");

type Value = string | number | bigint | null | ArrayBuffer | Uint8Array | boolean;

/** A value as an SQL literal. */
export function literal(v: Value): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof ArrayBuffer || v instanceof Uint8Array) return `X'${Buffer.from(v as Uint8Array).toString("hex")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

export const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

export interface Table {
  name: string;
  sql: string;
  columns: string[];
  rows: Value[][];
}

/** The dump: schema then data, in one transaction, foreign keys off while loading. */
export function dumpSql(tables: Table[], indexes: string[], at = new Date()): string {
  const out = [`-- Storm Central database backup, ${at.toISOString()}`, "PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const t of tables) {
    out.push(`${t.sql};`);
    const cols = t.columns.map(quoteIdent).join(", ");
    for (const r of t.rows) out.push(`INSERT INTO ${quoteIdent(t.name)} (${cols}) VALUES (${r.map(literal).join(", ")});`);
  }
  for (const i of indexes) out.push(`${i};`);
  out.push("COMMIT;", "");
  return out.join("\n");
}

const keyFor = (pass: string, salt: Buffer) => scryptSync(pass, salt, 32);

export function encrypt(plain: Buffer, pass: string): Buffer {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(pass, salt), iv);
  const body = Buffer.concat([c.update(gzipSync(plain)), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

export function decrypt(file: Buffer, pass: string): Buffer {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a Storm Central backup.");
  let o = MAGIC.length;
  const salt = file.subarray(o, (o += 16)), iv = file.subarray(o, (o += 12)), tag = file.subarray(o, (o += 16));
  const d = createDecipheriv("aes-256-gcm", keyFor(pass, salt), iv);
  d.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([d.update(file.subarray(o)), d.final()]));
  } catch {
    throw new Error("Wrong passphrase, or the file is damaged.");
  }
}

async function backup(env: Record<string, string | undefined>) {
  const url = env.DATABASE_URL || env.TURSO_DATABASE_URL;
  const pass = env.BACKUP_PASSPHRASE;
  if (!url || !pass) throw new Error("Set the DATABASE_URL (+ DATABASE_AUTH_TOKEN) and BACKUP_PASSPHRASE secrets.");
  const { createClient } = await import("@libsql/client/web");
  const db = createClient({ url, authToken: env.DATABASE_AUTH_TOKEN || env.TURSO_AUTH_TOKEN || undefined });
  const master = await db.execute("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' ORDER BY type DESC, name");
  const tables: Table[] = [];
  const indexes: string[] = [];
  for (const m of master.rows) {
    if (m.type === "index") indexes.push(String(m.sql));
    if (m.type !== "table") continue;
    const res = await db.execute(`SELECT * FROM ${quoteIdent(String(m.name))}`);
    tables.push({ name: String(m.name), sql: String(m.sql), columns: res.columns, rows: res.rows.map((r) => res.columns.map((c) => r[c] as Value)) });
  }
  const sql = dumpSql(tables, indexes);
  const out = env.BACKUP_OUT || "backup.sql.gz.enc";
  writeFileSync(out, encrypt(Buffer.from(sql), pass));
  console.log(`Backed up ${tables.length} tables (${tables.map((t) => `${t.name}: ${t.rows.length}`).join(", ")}) to ${out}.`);
}

function decryptFile(env: Record<string, string | undefined>, file: string, out?: string) {
  if (!env.BACKUP_PASSPHRASE) throw new Error("Set BACKUP_PASSPHRASE to the backup's passphrase.");
  const dest = out || file.replace(/\.gz\.enc$/, "") || `${file}.sql`;
  writeFileSync(dest, decrypt(readFileSync(file), env.BACKUP_PASSPHRASE));
  console.log(`Decrypted to ${dest}.`);
}

if (process.argv[1]?.endsWith("backup-db.mjs")) {
  const [cmd, file, out] = process.argv.slice(2);
  (cmd === "decrypt" ? Promise.resolve().then(() => decryptFile(process.env, file!, out)) : backup(process.env)).catch((err: unknown) => {
    console.error(`::error::${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
