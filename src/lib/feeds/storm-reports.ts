import { cached } from "./cache";
import { lsrWindow, parseHours, parseLsrGeoJson } from "./storm-parse";
import type { Feed } from "./types";
import { badParams, upstreamJson } from "./upstream";

/** Report categories we style and filter on (from the NWS LSR type text). */
export type StormReportKind = "tornado" | "funnel" | "hail" | "wind" | "wind-damage" | "flood" | "rain" | "snow" | "other";

/** One official NWS Local Storm Report. */
export interface StormReport {
  id: string;
  /** ISO time the event was observed (UTC). */
  time: string;
  kind: StormReportKind;
  /** NWS type text as issued, e.g. "TSTM WND GST", "HAIL". */
  typeText: string;
  magnitude: number | null;
  /** Unit of `magnitude`, e.g. "INCH", "MPH". */
  unit: string | null;
  /** True when the magnitude was measured rather than estimated. */
  measured: boolean | null;
  place: string;
  county: string | null;
  state: string | null;
  /** Who reported it, e.g. "TRAINED SPOTTER". */
  source: string | null;
  remark: string | null;
  wfo: string | null;
  lat: number;
  lon: number;
}

export interface StormReportsResponse {
  reports: StormReport[];
  hours: number;
  updated: string;
}

/** Iowa Environmental Mesonet's archive of NWS local storm reports (sts/ets in UTC). */
const IEM_LSR = "https://mesonet.agron.iastate.edu/geojson/lsr.geojson";

/** `hours=1..24` (default 6): official NWS local storm reports, CONUS. */
export const stormReportsFeed: Feed<StormReportsResponse> = {
  path: "/api/storm-reports",
  maxAge: 120,
  async load(sp) {
    const hours = parseHours(sp.get("hours"));
    if (hours == null) throw badParams("hours must be a number from 1 to 24");
    // The window rounds to 2 minutes, so clients polling together share one upstream request.
    const { sts, ets } = lsrWindow(Date.now(), hours);
    return cached(`lsr:${sts}:${ets}`, 120_000, async (): Promise<StormReportsResponse> => {
      const raw = await upstreamJson(`${IEM_LSR}?sts=${sts}&ets=${ets}`, {
        headers: { Accept: "application/geo+json, application/json" },
        timeoutMs: 20_000,
      });
      return { reports: parseLsrGeoJson(raw), hours, updated: new Date().toISOString() };
    });
  },
};
