import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { userSettings } from "../db/schema";
import { validateSettings, type SyncedSettings } from "../sync/settings";

export interface StoredSettings {
  data: SyncedSettings;
  /** When the device that sent them last changed them (epoch ms). */
  changedAt: number;
}

/** A person's synced settings, or null when they have none (or the row can't be read). */
export async function getSettings(userId: string): Promise<StoredSettings | null> {
  const db = await getDb();
  const row = (await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1))[0];
  if (!row) return null;
  let data: SyncedSettings | null = null;
  try {
    data = validateSettings(JSON.parse(row.data));
  } catch {
    /* a damaged row reads as none */
  }
  return data ? { data, changedAt: row.changedAt } : null;
}

/**
 * Keep these settings unless the account already holds ones changed later
 * (another device got there first): then nothing is written and those come
 * back instead.
 */
export async function putSettings(userId: string, data: SyncedSettings, changedAt: number, now = Date.now()): Promise<{ ok: true } | { ok: false; current: StoredSettings }> {
  const current = await getSettings(userId);
  if (current && current.changedAt > changedAt) return { ok: false, current };
  const db = await getDb();
  const fields = { data: JSON.stringify(data), changedAt, updatedAt: now };
  await db
    .insert(userSettings)
    .values({ userId, ...fields })
    .onConflictDoUpdate({ target: userSettings.userId, set: fields });
  return { ok: true };
}

export async function deleteSettings(userId: string) {
  const db = await getDb();
  await db.delete(userSettings).where(eq(userSettings.userId, userId));
}
