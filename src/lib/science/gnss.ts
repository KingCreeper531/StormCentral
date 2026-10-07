/**
 * GNSS visibility & DOP from CelesTrak OMM element sets, propagated with SGP4
 * (satellite.js). Lets drone pilots see satellite count and geometry *before*
 * they drive to the field — a key predictor of GPS-hold quality.
 */
import {
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  gstime,
  json2satrec,
  propagate,
  type OMMJsonObject,
  type SatRec,
} from "satellite.js";
import { computeDop, type Dop } from "./dop";

export const CONSTELLATIONS = ["GPS", "GLONASS", "Galileo", "BeiDou"] as const;
export type Constellation = (typeof CONSTELLATIONS)[number];

export interface GnssElementSet {
  constellation: Constellation;
  omm: OMMJsonObject;
}

export interface TrackedSat {
  name: string;
  constellation: Constellation;
  satrec: SatRec;
}

export interface SkySat {
  name: string;
  constellation: Constellation;
  azimuthDeg: number;
  elevationDeg: number;
}

export interface Visibility {
  time: Date;
  count: number;
  byConstellation: Record<Constellation, number>;
  sats: SkySat[];
  dop: Dop | null;
}

export function trackSatellites(sets: readonly GnssElementSet[]): TrackedSat[] {
  const out: TrackedSat[] = [];
  for (const s of sets) {
    try {
      const satrec = json2satrec(s.omm);
      if (satrec.error) continue;
      out.push({ name: String(s.omm.OBJECT_NAME), constellation: s.constellation, satrec });
    } catch {
      // Malformed element set — skip rather than fail the whole sky.
    }
  }
  return out;
}

export function visibilityAt(
  sats: readonly TrackedSat[],
  time: Date,
  lat: number,
  lon: number,
  opts: { heightKm?: number; maskDeg?: number } = {},
): Visibility {
  const mask = degreesToRadians(opts.maskDeg ?? 10);
  const observer = {
    latitude: degreesToRadians(lat),
    longitude: degreesToRadians(lon),
    height: opts.heightKm ?? 0,
  };
  const gmst = gstime(time);
  const byConstellation = { GPS: 0, GLONASS: 0, Galileo: 0, BeiDou: 0 } as Record<Constellation, number>;
  const visible: SkySat[] = [];
  const geometry: { azimuth: number; elevation: number }[] = [];

  for (const s of sats) {
    const pv = propagate(s.satrec, time);
    if (!pv?.position) continue;
    const look = ecfToLookAngles(observer, eciToEcf(pv.position, gmst));
    if (look.elevation < mask) continue;
    byConstellation[s.constellation]++;
    geometry.push({ azimuth: look.azimuth, elevation: look.elevation });
    visible.push({
      name: s.name,
      constellation: s.constellation,
      azimuthDeg: (look.azimuth * 180) / Math.PI,
      elevationDeg: (look.elevation * 180) / Math.PI,
    });
  }
  return { time, count: visible.length, byConstellation, sats: visible, dop: computeDop(geometry) };
}

/** Hourly satellite count & PDOP for the next `hours`. */
export function visibilityTimeline(
  sats: readonly TrackedSat[],
  start: Date,
  hours: number,
  lat: number,
  lon: number,
): { time: number; count: number; pdop: number | null }[] {
  const t0 = Math.floor(start.getTime() / 3_600_000) * 3_600_000;
  return Array.from({ length: hours }, (_, i) => {
    const v = visibilityAt(sats, new Date(t0 + i * 3_600_000), lat, lon);
    return { time: v.time.getTime(), count: v.count, pdop: v.dop?.pdop ?? null };
  });
}
