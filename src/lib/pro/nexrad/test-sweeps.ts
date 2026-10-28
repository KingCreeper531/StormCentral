/**
 * Synthetic sweeps for the derived-product tests (nrot, tds, srv, trail):
 * analytic fields sampled at each gate's centre, encoded like a decoded
 * sweep. Test-only.
 */
import { encodeSweep } from "./polar";
import type { Sweep } from "./sweep";

export const KT = 1.943844;
const DEG = Math.PI / 180;

export interface SynthGrid {
  radials?: number;
  gates?: number;
  firstKm?: number;
  gateKm?: number;
  /** Azimuth of the first radial's start. */
  start?: number;
  elevation?: number;
}

/** A sweep of `field(az, km)` (NaN or null: no data) on levels `lo`…`hi` in `step`s. */
export function polarSweep(field: (az: number, km: number) => number | null, lo: number, hi: number, step: number, o: SynthGrid = {}): Sweep {
  const R = o.radials ?? 720;
  const G = o.gates ?? 1200;
  const width = 360 / R;
  const firstKm = o.firstKm ?? 2.125;
  const gateKm = o.gateKm ?? 0.25;
  const azStart = Float32Array.from({ length: R }, (_, r) => ((o.start ?? 0) + r * width) % 360);
  const values = new Float32Array(R * G);
  for (let r = 0; r < R; r++) {
    const az = azStart[r]! + width / 2;
    for (let g = 0; g < G; g++) values[r * G + g] = field(az, firstKm + g * gateKm) ?? NaN;
  }
  const grid = { lat: 35.333, lon: -97.278, heightM: 390, time: 0, elevation: o.elevation ?? 0.5, nRadials: R, nGates: G, firstGateKm: firstKm, gateKm, azStart, azWidth: new Float32Array(R).fill(width) };
  return encodeSweep(grid, values, lo, hi, step, [{ level: 1, label: "RF" }]);
}

/** Km east and north of the radar of a gate at azimuth `az` and range `km`. */
export const xyOf = (az: number, km: number): [number, number] => [km * Math.sin(az * DEG), km * Math.cos(az * DEG)];

/**
 * Radial velocity (m/s) of a Rankine vortex (core radius `radiusKm`, peak
 * tangential speed `vmax`, counter-clockwise: cyclonic; negative `vmax` is
 * anticyclonic) centred at azimuth `az0`, range `km0`.
 */
export function rankine(az0: number, km0: number, radiusKm: number, vmax: number) {
  const [cx, cy] = xyOf(az0, km0);
  return (az: number, km: number) => {
    const [px, py] = xyOf(az, km);
    const dx = px - cx;
    const dy = py - cy;
    const rho = Math.hypot(dx, dy);
    if (rho < 1e-9) return 0;
    const vt = rho < radiusKm ? (vmax * rho) / radiusKm : (vmax * radiusKm) / rho;
    // Counter-clockwise tangent (−dy, dx)/ρ, onto the beam (px, py)/km.
    return (vt * (-dy * px + dx * py)) / (rho * km);
  };
}

/** A small deterministic random source (mulberry32). */
export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The gate index (radial, gate) nearest azimuth `az` and range `km` on a synthetic grid. */
export function gateAt(s: Sweep, az: number, km: number): number {
  const width = s.azWidth[0]!;
  const r = Math.floor((((az - s.azStart[0]! + 360) % 360) / width)) % s.nRadials;
  const g = Math.round((km - s.firstGateKm) / s.gateKm);
  return r * s.nGates + g;
}
