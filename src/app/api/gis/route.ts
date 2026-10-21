import { fetchGis } from "@/lib/server/gis-proxy";
import { tooMany } from "@/lib/server/guard";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { badRequest, errorResponse } from "@/lib/server/respond";

/**
 * GET /api/gis?url=… — a custom map layer (placefile, KML, GeoJSON) or a
 * placefile's icon sheet, fetched for the browser (lib/server/gis-proxy).
 * Shared CDN caching keeps popular feeds to one upstream read per half-minute.
 * Limited per IP: a radar re-reads each layer every 30 s at most and its icon
 * sheets once, so 120 a minute covers a dozen layers, or a few people behind
 * one address, with room to spare.
 */
export async function GET(req: Request) {
  const rl = rateLimit(`gis:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
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
