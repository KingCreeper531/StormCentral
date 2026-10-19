/**
 * Spotter reports confirmed by the NWS: a report whose kind, place and time
 * line up with one of the National Weather Service's Local Storm Reports is
 * marked "Confirmed by NWS" and counts as NWS_BONUS confirmations toward its
 * author's rank. Shared by the server's matcher and the report card.
 */
import type { Category } from "./community";
import type { StormReport, StormReportKind } from "./feeds/storm-reports";
import { haversineKm } from "./geo";

/** Confirmations an NWS-confirmed report is worth. */
export const NWS_BONUS = 5;
/** How far apart a report and the NWS's may be. */
export const NWS_MATCH_KM = 15;
/** The NWS report's event time may be up to an hour before the spotter posted, or half an hour after. */
const BEFORE_MS = 60 * 60_000;
const AFTER_MS = 30 * 60_000;
/** Reports older than this aren't looked at again (the NWS feed the matcher reads covers 24 hours). */
export const NWS_LOOKBACK_MS = 24 * 3_600_000;

/** Which kinds of NWS report can confirm each kind of spotter report. */
export const NWS_KINDS: Partial<Record<Category, readonly StormReportKind[]>> = {
  tornado: ["tornado", "funnel"],
  hail: ["hail"],
  wind: ["wind", "wind-damage"],
  flooding: ["flood"],
  rain: ["rain", "flood"],
  snow: ["snow"],
};
export const NWS_CATEGORIES = Object.keys(NWS_KINDS) as Category[];

/** What a confirmed report keeps of the NWS report it matched. */
export interface NwsReportRef {
  id: string;
  kind: StormReportKind;
  /** NWS type text as issued, e.g. "HAIL", "TSTM WND GST". */
  typeText: string;
  magnitude: number | null;
  unit: string | null;
  place: string;
  state: string | null;
  /** ISO time of the event. */
  time: string;
  /** Who reported it to the NWS, e.g. "TRAINED SPOTTER". */
  source: string | null;
}

export interface MatchCandidate {
  id: string;
  category: string;
  lat: number;
  lon: number;
  createdAt: number;
}

/** The NWS report that confirms each candidate, by post id: same kind, within NWS_MATCH_KM and the time window, nearest first. */
export function matchNwsReports(candidates: MatchCandidate[], reports: StormReport[]): Map<string, StormReport> {
  const out = new Map<string, StormReport>();
  for (const c of candidates) {
    const kinds = NWS_KINDS[c.category as Category];
    if (!kinds) continue;
    let best: { r: StormReport; score: number } | null = null;
    for (const r of reports) {
      if (!kinds.includes(r.kind)) continue;
      const t = Date.parse(r.time);
      if (!(t >= c.createdAt - BEFORE_MS && t <= c.createdAt + AFTER_MS)) continue;
      const km = haversineKm(c, r);
      if (km > NWS_MATCH_KM) continue;
      // Nearest in space and time together: a kilometre weighs like 4 minutes.
      const score = km + Math.abs(t - c.createdAt) / 240_000;
      if (!best || score < best.score) best = { r, score };
    }
    if (best) out.set(c.id, best.r);
  }
  return out;
}

export const nwsRef = (r: StormReport): NwsReportRef => ({
  id: r.id,
  kind: r.kind,
  typeText: r.typeText,
  magnitude: r.magnitude,
  unit: r.unit,
  place: r.place,
  state: r.state,
  time: r.time,
  source: r.source,
});

/** A stored NwsReportRef, or null when missing or malformed. */
export function parseNwsRef(json: string | null | undefined): NwsReportRef | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<NwsReportRef>;
    return typeof v.id === "string" && typeof v.typeText === "string" && typeof v.time === "string" && typeof v.place === "string"
      ? {
          id: v.id,
          kind: v.kind ?? "other",
          typeText: v.typeText,
          magnitude: typeof v.magnitude === "number" ? v.magnitude : null,
          unit: v.unit ?? null,
          place: v.place,
          state: v.state ?? null,
          time: v.time,
          source: v.source ?? null,
        }
      : null;
  } catch {
    return null;
  }
}
