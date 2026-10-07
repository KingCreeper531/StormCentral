import type { ScansResponse } from "@/lib/api/types";
import { cached } from "@/lib/server/cache";
import { parseIemScans } from "@/lib/server/parse";
import { badRequest, errorResponse, jsonResponse, upstreamJson } from "@/lib/server/upstream";

const isoMinute = (t: number) => new Date(t).toISOString().slice(0, 16) + "Z";

/** GET /api/radar/scans?site=LOT&product=N0B&minutes=90 — volume-scan index from IEM. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const site = (sp.get("site") ?? "").toUpperCase();
  const product = (sp.get("product") ?? "").toUpperCase();
  const minutes = Math.min(240, Math.max(15, Number(sp.get("minutes")) || 90));
  if (!/^[A-Z]{3,6}$/.test(site) || !/^[A-Z0-9]{3}$/.test(product)) return badRequest("invalid site/product");

  // Round the window to the minute so concurrent clients share a cache key.
  const end = Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
  const start = end - minutes * 60_000;
  try {
    const data = await cached(`scans:${site}:${product}:${minutes}:${end}`, 30_000, async () => {
      const url =
        `https://mesonet.agron.iastate.edu/json/radar.py?operation=list&radar=${site}&product=${product}` +
        `&start=${isoMinute(start)}&end=${isoMinute(end)}`;
      return { site, product, scans: parseIemScans(await upstreamJson(url)) } satisfies ScansResponse;
    });
    return jsonResponse(data, 30);
  } catch (err) {
    return errorResponse(err);
  }
}
