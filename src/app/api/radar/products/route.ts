import type { ProductsResponse } from "@/lib/api/types";
import { cached } from "@/lib/server/cache";
import { parseIemProducts } from "@/lib/server/parse";
import { badRequest, errorResponse, jsonResponse, upstreamJson } from "@/lib/server/upstream";

/** GET /api/radar/products?site=LOT — Level-III products IEM has for the last hour. */
export async function GET(req: Request) {
  const site = (new URL(req.url).searchParams.get("site") ?? "").toUpperCase();
  if (!/^[A-Z]{3,6}$/.test(site)) return badRequest("invalid site");
  const start = new Date(Math.floor(Date.now() / 600_000) * 600_000 - 3_600_000).toISOString().slice(0, 16) + "Z";
  try {
    const data = await cached(`products:${site}:${start}`, 10 * 60_000, async () => {
      const raw = await upstreamJson(
        `https://mesonet.agron.iastate.edu/json/radar.py?operation=products&radar=${site}&start=${start}`,
      );
      return { site, products: parseIemProducts(raw) } satisfies ProductsResponse;
    });
    return jsonResponse(data, 600);
  } catch (err) {
    return errorResponse(err);
  }
}
