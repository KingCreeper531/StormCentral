import { RAD, altitude, azimuth, siderealTime, sunCoords, toDays } from "./core";

export interface SunPosition {
  /** Degrees above the horizon (geometric, no refraction). */
  altitude: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const c = sunCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  return {
    altitude: altitude(H, phi, c.dec) / RAD,
    azimuth: (azimuth(H, phi, c.dec) / RAD + 180 + 360) % 360,
  };
}

export type SkyPhase = "night" | "astronomical" | "nautical" | "civil" | "golden" | "day";

/** Classify sun altitude into the photographic / aviation light phases. */
export function skyPhase(sunAltitude: number): SkyPhase {
  if (sunAltitude < -18) return "night";
  if (sunAltitude < -12) return "astronomical";
  if (sunAltitude < -6) return "nautical";
  if (sunAltitude < -0.833) return "civil";
  if (sunAltitude < 6) return "golden";
  return "day";
}

/**
 * Finds times within [start, start+hours] at which the sun crosses `altDeg`.
 * Coarse 10-min scan + bisection — robust at high latitudes where analytic
 * formulas break down (polar day/night simply yields no crossings).
 */
export function sunCrossings(start: Date, hours: number, lat: number, lon: number, altDeg: number) {
  const out: { time: Date; rising: boolean }[] = [];
  const step = 10 * 60_000;
  const end = start.getTime() + hours * 3_600_000;
  let t0 = start.getTime();
  let a0 = sunPosition(new Date(t0), lat, lon).altitude - altDeg;
  for (let t1 = t0 + step; t1 <= end; t1 += step) {
    const a1 = sunPosition(new Date(t1), lat, lon).altitude - altDeg;
    if (a0 === 0 || Math.sign(a0) !== Math.sign(a1)) {
      let lo = t0;
      let hi = t1;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const am = sunPosition(new Date(mid), lat, lon).altitude - altDeg;
        if (Math.sign(am) === Math.sign(a0)) lo = mid;
        else hi = mid;
      }
      out.push({ time: new Date((lo + hi) / 2), rising: a1 > a0 });
    }
    t0 = t1;
    a0 = a1;
  }
  return out;
}
