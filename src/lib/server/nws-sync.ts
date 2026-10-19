import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { posts } from "../db/schema";
import { stormReportsFeed, type StormReport } from "../feeds/storm-reports";
import { matchNwsReports, NWS_CATEGORIES, NWS_LOOKBACK_MS, nwsRef } from "../nws-match";

/** How often one server instance looks for new NWS confirmations. */
const EVERY_MS = 10 * 60_000;

const loadNwsReports = async (): Promise<StormReport[]> => (await stormReportsFeed.load(new URLSearchParams({ hours: "24" }))).reports;

/**
 * Matches the last day's unconfirmed spotter reports against the NWS's Local
 * Storm Reports (lib/nws-match) and marks the ones that line up. Returns how
 * many it confirmed.
 */
export async function syncNwsConfirmations({ now = Date.now(), loadReports = loadNwsReports } = {}): Promise<number> {
  const db = await getDb();
  const candidates = await db
    .select({ id: posts.id, category: posts.category, lat: posts.lat, lon: posts.lon, createdAt: posts.createdAt })
    .from(posts)
    .where(and(gt(posts.createdAt, now - NWS_LOOKBACK_MS), isNull(posts.nwsConfirmedAt), eq(posts.hidden, 0), inArray(posts.category, NWS_CATEGORIES)));
  if (!candidates.length) return 0;
  const matches = matchNwsReports(candidates, await loadReports());
  for (const [id, r] of matches) {
    await db
      .update(posts)
      .set({ nwsReport: JSON.stringify(nwsRef(r)), nwsConfirmedAt: now })
      .where(and(eq(posts.id, id), isNull(posts.nwsConfirmedAt)));
  }
  return matches.size;
}

let lastRun = 0;
let running: Promise<number> | null = null;

/**
 * syncNwsConfirmations at most every 10 minutes per server instance and never
 * twice at once: cheap enough to call from busy routes with after(), so no
 * cron job or secret is needed.
 */
export function maybeSyncNwsConfirmations(): Promise<number> {
  const now = Date.now();
  if (running) return running;
  if (now - lastRun < EVERY_MS) return Promise.resolve(0);
  lastRun = now;
  running = syncNwsConfirmations({ now })
    .catch((err: unknown) => {
      console.error("[nws-sync]", err instanceof Error ? err.message : err);
      return 0;
    })
    .finally(() => {
      running = null;
    });
  return running;
}
