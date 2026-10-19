import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { posts } from "../db/schema";
import { mpingOption, type MpingOption } from "../mping";

/**
 * mPING's REST API (v2). Submitting needs a token mPING grants on request
 * (MPING_TOKEN); without one, nothing is sent and the composer doesn't offer it.
 */
const apiBase = () => (process.env.MPING_API_URL || "https://mping.ou.edu/mping/api/v2").trim().replace(/\/+$/, "");
export const mpingEnabled = () => !!process.env.MPING_TOKEN?.trim();

export interface MpingDescription {
  id: number;
  name: string;
  category: string;
}

type Fetch = typeof fetch;

async function call(path: string, init: RequestInit, fetchImpl: Fetch): Promise<unknown> {
  const res = await fetchImpl(path.startsWith("http") ? path : `${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${process.env.MPING_TOKEN?.trim() ?? ""}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`mPING answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const DAY = 86_400_000;
let menu: { at: number; items: MpingDescription[] } | null = null;

/** mPING's report types (its "descriptions", each in a category), cached for a day. */
export async function mpingDescriptions(fetchImpl: Fetch = fetch): Promise<MpingDescription[]> {
  if (menu && Date.now() - menu.at < DAY) return menu.items;
  const items: MpingDescription[] = [];
  let next: string | null = "/description";
  for (let page = 0; next && page < 10; page++) {
    const data = (await call(next, {}, fetchImpl)) as { results?: unknown[]; next?: string | null } | unknown[];
    for (const raw of Array.isArray(data) ? data : (data.results ?? [])) {
      const d = raw as { id?: unknown; name?: unknown; description?: unknown; active?: unknown; category?: unknown };
      const name = typeof d.name === "string" ? d.name : typeof d.description === "string" ? d.description : null;
      const cat = d.category as { name?: unknown } | string | undefined;
      const category = typeof cat === "string" ? cat : typeof cat?.name === "string" ? cat.name : null;
      if (typeof d.id === "number" && name && category && d.active !== false) items.push({ id: d.id, name, category });
    }
    next = Array.isArray(data) ? null : (data.next ?? null);
  }
  menu = { at: Date.now(), items };
  return items;
}

/** mPING's id for an option: the first description (in mPING's order) whose category and name match. */
export const descriptionFor = (option: MpingOption, items: MpingDescription[]): number | null =>
  items.find((d) => option.category.test(d.category) && option.description.test(d.name))?.id ?? null;

/** The id mPING gave a submitted report (it answers with a GeoJSON FeatureCollection). */
function reportId(data: unknown): string | null {
  const v = data as { id?: unknown; features?: { id?: unknown; properties?: { id?: unknown } }[] };
  const id = v.features?.[0]?.id ?? v.features?.[0]?.properties?.id ?? v.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

export interface MpingReport {
  category: string;
  /** The MPING_OPTIONS key the spotter picked. */
  option: string;
  lat: number;
  lon: number;
  /** When it was observed (epoch ms). */
  at: number;
}

/** Sends one report to mPING; returns mPING's id for it (or "sent" when it gives none), null when mPING doesn't take it. */
export async function submitToMping(report: MpingReport, fetchImpl: Fetch = fetch): Promise<string | null> {
  const option = mpingOption(report.category, report.option);
  if (!option || !mpingEnabled()) return null;
  const descriptionId = descriptionFor(option, await mpingDescriptions(fetchImpl));
  if (descriptionId == null) throw new Error(`no mPING report type matches "${option.key}"`);
  const data = await call(
    "/reports",
    {
      method: "POST",
      body: JSON.stringify({
        description_id: descriptionId,
        obtime: new Date(report.at).toISOString().replace(/\.\d{3}Z$/, "Z"),
        geom: { type: "Point", coordinates: [report.lon, report.lat] },
      }),
    },
    fetchImpl,
  );
  return reportId(data) ?? "sent";
}

/** For after() once a report is posted: send it to mPING and keep mPING's id. Failures are logged, never shown to the spotter. */
export async function sendPostToMping(postId: string, report: MpingReport): Promise<void> {
  try {
    const id = await submitToMping(report);
    if (id) await (await getDb()).update(posts).set({ mpingId: id }).where(eq(posts.id, postId));
  } catch (err) {
    console.error("[mping]", err instanceof Error ? err.message : err);
  }
}

/** For tests: forget the cached menu. */
export const resetMpingMenu = () => {
  menu = null;
};
