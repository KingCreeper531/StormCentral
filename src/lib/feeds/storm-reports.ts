import { HttpError } from "../api/http";
import type { Feed } from "./types";

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

/** `hours=1..24` (default 6): official NWS local storm reports, CONUS. */
export const stormReportsFeed: Feed<StormReportsResponse> = {
  path: "/api/storm-reports",
  maxAge: 120,
  async load() {
    throw new HttpError("Storm reports aren't implemented yet", 501);
  },
};
