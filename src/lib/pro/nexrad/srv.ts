/**
 * Storm-relative velocity (SRV) for Level II sweeps: base velocity with the
 * storm's own motion taken out, so rotation inside a fast-moving storm shows
 * as a balanced couplet. A storm moving toward θ at speed S adds S·cos(az − θ)
 * to the radial velocity at azimuth az (positive away from the radar), so
 *
 *   SRV = V − S·cos(az − θ).
 *
 * θ is the direction the storm moves TOWARD. Warnings (TIME...MOT...LOC),
 * storm cells and the storm tools' "From" give the direction it comes FROM,
 * the meteorological convention: `towardOf` turns one into the other.
 */
import { centres, encodeSweep, gateValues } from "./polar";
import type { Sweep } from "./sweep";

const DEG = Math.PI / 180;

export interface SrvMotion {
  /** Direction of travel (toward), degrees clockwise from north. */
  towardDeg: number;
  /** Knots (the unit of decoded velocity). */
  speedKt: number;
}

/** A motion given as the direction it comes FROM (NWS, storm cells) → the direction it moves toward. */
export const towardOf = (fromDeg: number) => (((fromDeg + 180) % 360) + 360) % 360;

/** The storm's own motion along the beam at azimuth `az` (knots, positive away from the radar). */
export const motionAlongBeam = (m: SrvMotion, az: number) => m.speedKt * Math.cos((az - m.towardDeg) * DEG);

/**
 * The sweep (velocity in knots) relative to the storm motion, on the same
 * value step (rounded to it: under half a step off, finer than the data).
 * Range-folded gates stay range folded.
 */
export function stormRelative(s: Sweep, m: SrvMotion): Sweep {
  const v = gateValues(s);
  const az = centres(s);
  const G = s.nGates;
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r < s.nRadials; r++) {
    const d = motionAlongBeam(m, az[r]!);
    for (let i = r * G, end = i + G; i < end; i++) {
      const x = v[i]! - d;
      v[i] = x;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  const step = s.table[3]! - s.table[2]! || 1;
  if (!(lo <= hi)) lo = hi = 0;
  const out = encodeSweep(s, v, Math.floor(lo / step) * step, hi, step, [{ level: 1, label: "RF" }]);
  for (let i = 0; i < s.data.length; i++) if (s.data[i] === 1) out.data[i] = 1;
  return out;
}
