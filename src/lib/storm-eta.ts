/**
 * Radar storm cells heading for a place: when each arrives, how strong it is
 * and how it's moving. The server answers this for one point
 * (/api/storm-eta) so phones never download the whole country's cells.
 */
import type { StormCell } from "./feeds/storm-cells";
import { cellEta, cellHeading, cellSeverity, type CellLevel } from "./feeds/storm-parse";
import { haversineKm, type LatLon } from "./geo";

/** A cell this strong (dBZ) counts as a thunderstorm worth knowing about even without hail or rotation. */
export const STRONG_DBZ = 50;
/** Cells passing within this distance either side of the place count as arriving. */
export const CORRIDOR_KM = 10;

export interface IncomingStorm {
  id: string;
  /** Minutes until it reaches the place (from now). */
  etaMin: number;
  /** Epoch ms of arrival. */
  arrivesAt: number;
  level: CellLevel;
  distanceKm: number;
  /** Direction it moves toward, degrees, and speed in knots. */
  headingDeg: number;
  speedKt: number;
  maxHailIn: number | null;
  maxDbz: number | null;
  tvs: StormCell["tvs"];
  meso: number | null;
  radar: string;
  stormId: string;
  lat: number;
  lon: number;
}

export interface StormEtaResponse {
  storms: IncomingStorm[];
  /** When the radar data was fetched. */
  updated: string;
}

/** Whether a cell is strong enough to show and announce. */
export const isNotableCell = (c: Pick<StormCell, "tvs" | "meso" | "maxHailIn" | "severeHailProb" | "maxDbz">) =>
  cellSeverity(c) >= 1 || (c.maxDbz ?? 0) >= STRONG_DBZ;

/** Notable cells arriving within the hour, soonest first (strongest first on ties). */
export function incomingStorms(cells: readonly StormCell[], p: LatLon, now: number, limit = 5): IncomingStorm[] {
  const out: IncomingStorm[] = [];
  for (const c of cells) {
    if (!c.motion || !isNotableCell(c)) continue;
    const eta = cellEta(c, p, { now, corridorKm: CORRIDOR_KM });
    if (eta == null) continue;
    out.push({
      id: c.id,
      etaMin: Math.max(0, Math.round(eta)),
      arrivesAt: now + Math.round(eta * 60_000),
      level: cellSeverity(c),
      distanceKm: Math.round(haversineKm(c, p) * 10) / 10,
      headingDeg: Math.round(cellHeading(c.motion)),
      speedKt: Math.round(c.motion.speedKt),
      maxHailIn: c.maxHailIn,
      maxDbz: c.maxDbz,
      tvs: c.tvs,
      meso: c.meso,
      radar: c.radar,
      stormId: c.stormId,
      lat: c.lat,
      lon: c.lon,
    });
  }
  return out.sort((a, b) => a.etaMin - b.etaMin || b.level - a.level).slice(0, limit);
}
