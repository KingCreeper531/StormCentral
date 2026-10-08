import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { SCHEMA_SQL, schema } from "./schema";

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
 */
const g = globalThis as typeof globalThis & { __stormcentralDb?: Promise<DbHandle> };

export function openDb(url: string, authToken?: string): Promise<DbHandle> {
  if (url.startsWith("file:")) {
    const file = url.slice("file:".length);
    if (file && !file.startsWith(":memory:")) mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const client = createClient({ url, authToken });
  return client.executeMultiple(SCHEMA_SQL).then(() => ({ client, db: drizzle(client, { schema }) }));
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
