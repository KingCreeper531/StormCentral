/**
 * Pairs NWS warnings with NWS local storm reports: what trained SKYWARN
 * spotters, storm chasers, emergency managers and the public reported inside
 * a warning's polygon while it was in effect. This is how forecasters verify
 * warnings, and it tells a reader what a storm is actually doing.
 */
import type { WeatherAlert } from "./api/types";
import type { StormReport } from "./feeds/storm-reports";
import { geometryContains } from "./geo";

/** Reports this long before issuance still count (spotter reports often prompt the warning). */
const LEAD_MS = 15 * 60_000;

export interface AlertReports {
  reports: StormReport[];
  /** Reports from SKYWARN-trained spotters, chasers, emergency managers or NWS staff. */
  spotters: number;
  maxHailIn: number | null;
  maxWindMph: number | null;
  tornadoes: number;
}

const SPOTTER = /SPOTTER|CHASER|EMERGENCY|LAW ENF|FIRE DEPT|NWS|AMATEUR RADIO|SKYWARN|OFFICIAL/i;
export const isSpotterSource = (source: string | null) => !!source && SPOTTER.test(source);

export function reportsInAlert(a: WeatherAlert, reports: readonly StormReport[], now: number): AlertReports {
  const out: AlertReports = { reports: [], spotters: 0, maxHailIn: null, maxWindMph: null, tornadoes: 0 };
  if (!a.geometry) return out;
  const start = Date.parse(a.sent || a.effective) - LEAD_MS;
  const end = Math.min(now, Date.parse(a.ends ?? a.expires) || now);
  for (const r of reports) {
    const t = Date.parse(r.time);
    if (!(t >= start && t <= end) || !geometryContains(a.geometry, r)) continue;
    out.reports.push(r);
    if (isSpotterSource(r.source)) out.spotters++;
    const unit = (r.unit ?? "").toUpperCase();
    if (r.kind === "hail" && r.magnitude != null) out.maxHailIn = Math.max(out.maxHailIn ?? 0, unit.startsWith("MM") ? r.magnitude / 25.4 : r.magnitude);
    if (r.kind === "tornado") out.tornadoes++;
    if ((r.kind === "wind" || r.kind === "wind-damage") && r.magnitude != null && /MPH|KT|KNOT/.test(unit)) out.maxWindMph = Math.max(out.maxWindMph ?? 0, /KT|KNOT/.test(unit) ? r.magnitude * 1.15078 : r.magnitude);
  }
  out.reports.sort((x, y) => Date.parse(y.time) - Date.parse(x.time));
  return out;
}
