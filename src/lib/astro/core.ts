/**
 * Low-precision solar & lunar ephemerides (Meeus-derived; accuracy ~0.1° for
 * the sun and ~1° for the moon), which is ample for twilight, golden-hour and
 * solunar timing. Angles are radians internally, degrees at the API surface.
 */

export const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

export const toJulian = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970;
export const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
export const toDays = (date: Date) => toJulian(date) - J2000;

export const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));

export const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));

export const siderealTime = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;

export const altitude = (H: number, phi: number, dec: number) =>
  Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));

export const azimuth = (H: number, phi: number, dec: number) =>
  Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));

/** Atmospheric refraction (Sæmundsson), valid for altitudes above ~-1°. */
export function refraction(h: number) {
  const hh = Math.max(h, 0);
  return 0.0002967 / Math.tan(hh + 0.00312536 / (hh + 0.08901179));
}

export function solarMeanAnomaly(d: number) {
  return RAD * (357.5291 + 0.98560028 * d);
}

export function eclipticLongitude(M: number) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372; // perihelion of Earth
  return M + C + P + Math.PI;
}

export function sunCoords(d: number) {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

export function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d); // ecliptic longitude
  const M = RAD * (134.963 + 13.064993 * d); // mean anomaly
  const F = RAD * (93.272 + 13.22935 * d); // mean distance
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M); // km
  return { ra: rightAscension(l, b), dec: declination(l, b), dist };
}

export { DAY_MS };
