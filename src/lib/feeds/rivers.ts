import type { RiversResponse } from "../api/types";
import { parseUsgsIv, parseUsgsOgcLatest } from "./parse";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, parseLatLon, upstreamJson } from "./upstream";

/** `lat` & `lon`: nearest USGS stream gauges with 48 h history. */
export const riversFeed: Feed<RiversResponse> = {
  path: "/api/rivers",
  maxAge: 600,
  async load(sp) {
    const p = parseLatLon(sp);
    if (!p) throw badParams("lat/lon required");
    // Snap to a 0.1° grid so nearby users share the cache entry.
    const lat = Math.round(p.lat * 10) / 10;
    const lon = Math.round(p.lon * 10) / 10;
    const bbox = [lon - 0.7, lat - 0.5, lon + 0.7, lat + 0.5].map((v) => v.toFixed(3)).join(",");
    return cached(`rivers:${lat}:${lon}`, 10 * 60_000, async (): Promise<RiversResponse> => {
      try {
        const raw = await upstreamJson(
          `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=00060,00065,00010&siteType=ST&siteStatus=active&period=P2D`,
          { timeoutMs: 20_000 },
        );
        return { sites: parseUsgsIv(raw, p), source: "usgs-iv" };
      } catch (err) {
        // Legacy WaterServices is being retired; fall back to the OGC API.
        const raw = await upstreamJson(
          `https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?f=json&limit=500&bbox=${bbox}&parameter_code=00060,00065,00010`,
        ).catch(() => {
          throw err;
        });
        return { sites: parseUsgsOgcLatest(raw, p), source: "usgs-ogc" };
      }
    });
  },
};
