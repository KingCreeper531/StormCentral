import { parseAfd, type ParsedAfd } from "../afd";
import { HttpError } from "../api/http";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson } from "./upstream";

const NWS = "https://api.weather.gov";

export interface ForecasterNotesResponse extends ParsedAfd {
  /** Three-letter NWS office id, e.g. "PBZ". */
  office: string;
  issued: string;
  /** The full product on weather.gov. */
  url: string;
}

/**
 * `lat` & `lon`: the latest Area Forecast Discussion from the NWS office
 * that forecasts for the point (US only; 404 elsewhere).
 */
export const forecasterNotesFeed: Feed<ForecasterNotesResponse> = {
  path: "/api/forecaster-notes",
  maxAge: 900,
  async load(sp) {
    const p = parseLatLon(sp);
    if (!p) throw badParams("lat/lon required");
    const point = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
    // The office for a point never changes.
    const office = await cached(
      `nws-office:${point}`,
      30 * 86_400_000,
      async () => {
        const r = await upstreamJson<{ properties?: { cwa?: string } }>(`${NWS}/points/${point}`).catch((err) => {
          // weather.gov answers 404 outside the US.
          if (err instanceof HttpError && err.status === 404) throw new HttpError("Forecaster notes are only available in the US", 404);
          throw err;
        });
        const cwa = r.properties?.cwa;
        if (!cwa || !/^[A-Z]{3}$/.test(cwa)) throw new HttpError("No NWS office for this location", 404);
        return cwa;
      },
      { persist: true },
    );
    return cached(`afd:${office}`, 10 * 60_000, async () => {
      const list = await upstreamJson<{ "@graph"?: { id?: string; issuanceTime?: string }[] }>(`${NWS}/products/types/AFD/locations/${office}`);
      const latest = list["@graph"]?.[0];
      if (!latest?.id) throw new HttpError(`No forecast discussion from ${office} right now`, 404);
      const product = await upstreamJson<{ productText?: string; issuanceTime?: string }>(`${NWS}/products/${encodeURIComponent(latest.id)}`);
      if (!product.productText) throw new HttpError("Empty forecast discussion", 502);
      return {
        office,
        issued: product.issuanceTime ?? latest.issuanceTime ?? new Date().toISOString(),
        url: `https://forecast.weather.gov/product.php?site=${office}&issuedby=${office}&product=AFD`,
        ...parseAfd(product.productText),
      };
    });
  },
};
