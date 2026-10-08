import "server-only";
import { desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { posts, users } from "../db/schema";
import { summarize, type ModelSnapshot, type ScorableReport, type ScorecardSummary, type ScorecardWindow } from "../scorecard";

/** Upper bound on reports read per request; a window beyond this scores its most recent reports. */
const MAX_ROWS = 20_000;

/**
 * Lenient reader for stored snapshots: unknown keys are dropped rather than
 * rejected, so snapshots from newer composers (e.g. with precipitation) still
 * score, and older ones without the optional fields do too.
 */
const finite = z.number().finite().nullable().optional();
const snapshotSchema = z.object({
  tempC: finite,
  code: z.number().int().min(0).max(99).nullable().optional(),
  windMs: finite,
  gustMs: finite,
  precipMm: finite,
  precipProb: finite,
});

function parseSnapshot(json: string | null): ModelSnapshot | null {
  if (!json) return null;
  try {
    const r = snapshotSchema.safeParse(JSON.parse(json));
    if (!r.success) return null;
    const s = r.data;
    return {
      tempC: s.tempC ?? null,
      code: s.code ?? null,
      windMs: s.windMs ?? null,
      gustMs: s.gustMs ?? null,
      ...(s.precipMm !== undefined && { precipMm: s.precipMm }),
      ...(s.precipProb !== undefined && { precipProb: s.precipProb }),
    };
  } catch {
    return null;
  }
}

/**
 * Self-hosted servers (desktop app, Node) have no CDN in front of the route,
 * so keep each window's summary in memory briefly and share in-flight queries.
 */
const CACHE_MS = 60_000;
const cache = new Map<ScorecardWindow, { at: number; value: Promise<ScorecardSummary> }>();

/** Cached forecast-vs-report scorecard for the last `days` days. */
export function getScorecard(days: ScorecardWindow): Promise<ScorecardSummary> {
  const now = Date.now();
  const hit = cache.get(days);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const entry = { at: now, value: computeScorecard(days, now) };
  cache.set(days, entry);
  entry.value.catch(() => {
    if (cache.get(days) === entry) cache.delete(days); // don't cache failures
  });
  return entry.value;
}

/** Forecast-vs-report scorecard over the last `days` days. Public fields only (no emails, no coordinates). */
export async function computeScorecard(days: ScorecardWindow, now = Date.now()): Promise<ScorecardSummary> {
  const db = await getDb();
  const since = now - days * 86_400_000;
  const rows = await db
    .select({
      id: posts.id,
      category: posts.category,
      severity: posts.severity,
      createdAt: posts.createdAt,
      place: posts.place,
      conditions: posts.conditions,
      username: users.username,
    })
    .from(posts)
    .innerJoin(users, eq(posts.userId, users.id))
    .where(gte(posts.createdAt, since))
    .orderBy(desc(posts.createdAt))
    .limit(MAX_ROWS);

  const reports: ScorableReport[] = rows.map((r) => ({ ...r, conditions: parseSnapshot(r.conditions) }));
  return summarize(reports, { days, since, now });
}
