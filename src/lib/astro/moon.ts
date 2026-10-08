import { RAD, altitude, azimuth, moonCoords, siderealTime, sunCoords, toDays } from "./core";

export const SYNODIC_MONTH = 29.530588853;

export interface MoonIllumination {
  /** Illuminated fraction 0..1. */
  fraction: number;
  /** Phase 0..1: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
  /** Days since new moon. */
  age: number;
  name: MoonPhaseName;
  waxing: boolean;
}

export type MoonPhaseName =
  | "New Moon"
  | "Waxing Crescent"
  | "First Quarter"
  | "Waxing Gibbous"
  | "Full Moon"
  | "Waning Gibbous"
  | "Last Quarter"
  | "Waning Crescent";

export function moonPhaseName(phase: number): MoonPhaseName {
  const p = ((phase % 1) + 1) % 1;
  // Principal phases get a ±1.85-day (1/16 cycle) window.
  if (p < 0.0625 || p >= 0.9375) return "New Moon";
  if (p < 0.1875) return "Waxing Crescent";
  if (p < 0.3125) return "First Quarter";
  if (p < 0.4375) return "Waxing Gibbous";
  if (p < 0.5625) return "Full Moon";
  if (p < 0.6875) return "Waning Gibbous";
  if (p < 0.8125) return "Last Quarter";
  return "Waning Crescent";
}

export function moonIllumination(date: Date): MoonIllumination {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const SUN_DIST = 149_598_000; // km

  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra),
  );
  const inc = Math.atan2(SUN_DIST * Math.sin(phi), m.dist - SUN_DIST * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra),
  );
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase,
    age: phase * SYNODIC_MONTH,
    name: moonPhaseName(phase),
    waxing: phase < 0.5,
  };
}

export function moonPosition(date: Date, lat: number, lon: number) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  // Topocentric parallax correction (Meeus 14.1) — matters near the horizon.
  const pa = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(c.dec) - Math.sin(c.dec) * Math.cos(H));
  h -= Math.asin(6378.14 / c.dist) * Math.cos(h);
  return {
    altitude: h / RAD,
    azimuth: (azimuth(H, phi, c.dec) / RAD + 180 + 360) % 360,
    distanceKm: c.dist,
    parallacticAngle: pa / RAD,
  };
}
