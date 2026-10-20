import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { liveDrawing } from "../db/schema";
import { cleanShapes, type Shape } from "../draw/shapes";

const ROW = "live";
/** A drawing left on air this long is dropped: the presenter forgot it. */
export const LIVE_DRAWING_MAX_AGE_MS = 6 * 3_600_000;

/** The drawing on the live stream now (empty when there's none, or it's gone stale). */
export async function getLiveDrawing(now = Date.now()): Promise<{ shapes: Shape[]; updatedAt: number | null }> {
  const db = await getDb();
  const row = (await db.select().from(liveDrawing).where(eq(liveDrawing.id, ROW)).limit(1))[0];
  if (!row || row.updatedAt < now - LIVE_DRAWING_MAX_AGE_MS) return { shapes: [], updatedAt: row?.updatedAt ?? null };
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(row.shapes);
  } catch {
    /* a damaged row reads as nothing drawn */
  }
  return { shapes: cleanShapes(parsed), updatedAt: row.updatedAt };
}

/** Replace the drawing on air. */
export async function setLiveDrawing(userId: string, shapes: readonly Shape[], now = Date.now()) {
  const db = await getDb();
  const fields = { shapes: JSON.stringify(shapes), userId, updatedAt: now };
  await db
    .insert(liveDrawing)
    .values({ id: ROW, ...fields })
    .onConflictDoUpdate({ target: liveDrawing.id, set: fields });
}
