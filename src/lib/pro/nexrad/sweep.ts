/**
 * One radar sweep (a single elevation of one moment) in a compact,
 * transferable form, plus the beam geometry to find the gate under a lat/lon
 * (the GPU layer, sweep-layer.ts, does the same per pixel).
 *
 * Shared by the Level II and Level III decoders, the decoding worker, the
 * map layer and the cursor readout on the main thread.
 */

export interface Sweep {
  /** Radar location (degrees) and antenna height above sea level (m). */
  lat: number;
  lon: number;
  heightM: number;
  /** Volume scan start, epoch ms. */
  time: number;
  /** Elevation angle, degrees (0 for products that aren't tied to one, like VIL). */
  elevation: number;
  nRadials: number;
  nGates: number;
  /** Range to the centre of the first gate and gate spacing, km (slant range). */
  firstGateKm: number;
  gateKm: number;
  /** Start azimuth and width of each radial, degrees clockwise from north. */
  azStart: Float32Array;
  azWidth: Float32Array;
  /** Raw levels, radial-major (nRadials × nGates). */
  data: Uint8Array | Uint16Array;
  /** Raw level → physical value; NaN where there's no data. */
  table: Float32Array;
  /** Raw levels with a meaning instead of a value, e.g. range folded. */
  special: { level: number; label: string }[];
}

const R_EARTH_KM = 6371.0088;
/** 4/3 effective earth radius for standard beam refraction. */
const KA = (4 / 3) * R_EARTH_KM;
const DEG = Math.PI / 180;

/** Slant range (km) to the point `groundKm` along the ground, for a beam at `elevDeg` (4/3-earth model). */
export function slantRange(groundKm: number, elevDeg: number): number {
  const phi = groundKm / KA;
  const c = Math.cos(elevDeg * DEG + phi);
  return c <= 0 ? Infinity : (KA * Math.sin(phi)) / c;
}

/** Azimuth (0.1° bins) → radial index, so every pixel's lookup is one array read. */
export function azimuthIndex(s: Pick<Sweep, "nRadials" | "azStart" | "azWidth">): Int32Array {
  const lut = new Int32Array(3600).fill(-1);
  for (let i = 0; i < s.nRadials; i++) {
    const start = Math.round(s.azStart[i]! * 10);
    const width = Math.max(1, Math.round(s.azWidth[i]! * 10));
    for (let k = 0; k < width; k++) lut[(((start + k) % 3600) + 3600) % 3600] = i;
  }
  // Fill single-bin gaps between radials (rounding) with the neighbour.
  for (let k = 0; k < 3600; k++) if (lut[k] === -1) lut[k] = lut[(k + 3599) % 3600]!;
  return lut;
}

/** Ground distance (km) and bearing (deg) from the radar to a point. */
export function polarOf(s: Pick<Sweep, "lat" | "lon">, lat: number, lon: number): { km: number; az: number } {
  const p1 = s.lat * DEG;
  const p2 = lat * DEG;
  const dl = (lon - s.lon) * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const km = 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  const az = (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / DEG + 360) % 360;
  return { km, az };
}

/** The raw level under a point, or -1 outside the sweep. */
export function levelAt(s: Sweep, lat: number, lon: number, azLut = azimuthIndex(s)): number {
  const { km, az } = polarOf(s, lat, lon);
  const gate = Math.floor((slantRange(km, s.elevation) - s.firstGateKm) / s.gateKm + 0.5);
  if (gate < 0 || gate >= s.nGates) return -1;
  const r = azLut[Math.floor(az * 10) % 3600]!;
  return r < 0 ? -1 : s.data[r * s.nGates + gate]!;
}

/** Max ground range covered by the sweep, km. */
export function maxRangeKm(s: Pick<Sweep, "firstGateKm" | "gateKm" | "nGates" | "elevation">): number {
  const slant = s.firstGateKm + s.gateKm * s.nGates;
  return slant * Math.cos(s.elevation * DEG);
}

/** Colour every raw level through a value → colour function (levels with no value stay clear). */
export function levelColors(table: Float32Array, color: (value: number) => [number, number, number] | null): Uint8Array {
  const out = new Uint8Array(table.length * 4);
  for (let i = 0; i < table.length; i++) {
    const v = table[i]!;
    if (Number.isNaN(v)) continue;
    const c = color(v);
    if (!c) continue;
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}
