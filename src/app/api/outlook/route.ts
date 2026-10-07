import type { OutlookResponse } from "@/lib/api/types";
import { cached } from "@/lib/server/cache";
import { parseSpcOutlook } from "@/lib/server/parse";
import { errorResponse, jsonResponse, upstreamJson } from "@/lib/server/upstream";

/** GET /api/outlook?day=1 — SPC categorical convective outlook polygons. */
export async function GET(req: Request) {
  const day = Number(new URL(req.url).searchParams.get("day") ?? 1);
  const d = (day === 2 || day === 3 ? day : 1) as 1 | 2 | 3;
  try {
    const data = await cached(`spc:${d}`, 10 * 60_000, async () => {
      const raw = await upstreamJson(`https://www.spc.noaa.gov/products/outlook/day${d}otlk_cat.lyr.geojson`, {
        headers: { Accept: "application/geo+json, application/json" },
      });
      return { day: d, ...parseSpcOutlook(raw) } satisfies OutlookResponse;
    });
    return jsonResponse(data, 600);
  } catch (err) {
    return errorResponse(err);
  }
}
