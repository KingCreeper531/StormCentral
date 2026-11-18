import { fetchGis } from "@/lib/server/gis-proxy";
import { tooMany } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { badRequest, errorResponse } from "@/lib/server/respond";

/**
 * GET /api/gis?url=… — a custom map layer (placefile, KML, GeoJSON) or a
 * placefile's icon sheet, fetched for the browser (lib/server/gis-proxy).
 * Shared CDN caching keeps popular feeds to one upstream read per half-minute.
 *
 * It needs no account, so it's limited twice. Per IP: the most a radar asks
 * for is 20 layers (MAX_GIS_LAYERS) re-read every 30 s at most, 40 a minute,
 * plus each icon sheet once, so 60 a minute covers it. In all: a cap on the
 * whole proxy, so many addresses together can't turn it into a free proxy.
 * The cap is counted only for requests that passed their IP's limit.
 */
const PER_IP_PER_MINUTE = 60;
const ALL_PER_MINUTE = 1_200;

export async function GET(req: Request) {
  const rl = await rateLimit(`gis:${clientIp(req)}`, PER_IP_PER_MINUTE, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const all = await rateLimit("gis-all:all", ALL_PER_MINUTE, 60_000);
  if (!all.ok) return tooMany(all.retryAfterSec);
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return badRequest("Add ?url= with the layer's link");
  try {
    const { body, type } = await fetchGis(url);
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
