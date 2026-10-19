import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Client } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { drizzle } from "drizzle-orm/libsql/web";
import { COLUMN_MIGRATIONS, SCHEMA_SQL, schema } from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

interface DbHandle {
  client: Client;
  db: Db;
}

/**
 * Lazily opens the database and applies the idempotent schema exactly once
 * per process. Local dev uses an embedded SQLite file; set DATABASE_URL to a
 * libsql:// (Turso) URL for serverless deployments.
 * Stored on globalThis so dev-mode HMR doesn't leak a pool per reload.
 *
 * Only a local file needs the native SQLite driver, so it's loaded just for
 * that; a remote database goes through the plain-fetch web client. Vercel
 * builds leave the native driver (~20 MB per function, per deployment) out
 * entirely (next.config.ts).
 */
const g = globalThis as typeof globalThis & { __stormcentralDb?: Promise<DbHandle> };

async function connect(url: string, authToken?: string): Promise<Client> {
  if (url.startsWith("file:") || url === ":memory:") {
    if (process.env.VERCEL) throw new Error("A file: DATABASE_URL can't work on Vercel: connect a Turso database (Storage tab), then redeploy.");
    const file = url.slice("file:".length);
    if (file && !file.startsWith(":memory:")) mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    return (await import("@libsql/client")).createClient({ url, authToken });
  }
  return (await import("@libsql/client/web")).createClient({ url, authToken });
}

export async function openDb(url: string, authToken?: string): Promise<DbHandle> {
  const client = await connect(url, authToken);
  await client.executeMultiple(SCHEMA_SQL);
  for (const m of COLUMN_MIGRATIONS) {
    const cols = await client.execute(`PRAGMA table_info(${m.table})`);
    if (!cols.rows.some((r) => r.name === m.column)) await client.execute(m.sql);
  }
  return { client, db: drizzle({ client, schema }) };
}

/**
 * DATABASE_URL / DATABASE_AUTH_TOKEN, or the TURSO_* names that Vercel's Turso
 * integration sets, so connecting a database in the Vercel dashboard is enough.
 */
function dbConfig(): { url: string; authToken?: string } {
  const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;
  if (url) return { url, authToken };
  // Serverless hosts have no writable disk for the local SQLite fallback.
  if (process.env.VERCEL) throw new Error("No database configured: connect a Turso database to this Vercel project (Storage tab), then redeploy.");
  return { url: "file:./data/stormcentral.db" };
}

export async function getDb(): Promise<Db> {
  g.__stormcentralDb ??= Promise.resolve()
    .then(() => {
      const { url, authToken } = dbConfig();
      return openDb(url, authToken);
    })
    .catch((err) => {
      g.__stormcentralDb = undefined; // allow a retry on the next request
      throw err;
    });
  return (await g.__stormcentralDb).db;
}
