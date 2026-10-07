import type { OutlookResponse } from "../api/types";
import { parseSpcOutlook } from "./parse";
import { cached } from "./cache";
import type { Feed } from "./types";
import { upstreamJson } from "./upstream";

/** `day=1|2|3`: SPC categorical convective outlook polygons. */
export const outlookFeed: Feed<OutlookResponse> = {
  path: "/api/outlook",
  maxAge: 600,
  async load(sp) {
    const day = Number(sp.get("day") ?? 1);
    const d = (day === 2 || day === 3 ? day : 1) as 1 | 2 | 3;
    return cached(`spc:${d}`, 10 * 60_000, async () => {
      const raw = await upstreamJson(`https://www.spc.noaa.gov/products/outlook/day${d}otlk_cat.lyr.geojson`, {
        headers: { Accept: "application/geo+json, application/json" },
      });
      return { day: d, ...parseSpcOutlook(raw) };
    });
  },
};
