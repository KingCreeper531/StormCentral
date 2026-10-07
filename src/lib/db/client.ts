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

export async function getDb(): Promise<Db> {
  g.__stormcentralDb ??= openDb(
    process.env.DATABASE_URL ?? "file:./data/stormcentral.db",
    process.env.DATABASE_AUTH_TOKEN,
  ).catch((err) => {
    g.__stormcentralDb = undefined; // allow a retry on the next request
    throw err;
  });
  return (await g.__stormcentralDb).db;
}
