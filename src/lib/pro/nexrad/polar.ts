/**
 * Helpers for products worked out from decoded sweeps (storm-relative
 * velocity, NROT, debris probability, max trails): a sweep's gates as
 * physical values, one sweep's gates looked up on another's grid (the
 * moments of a split cut come from two scans with their own radials), and
 * values encoded back into a sweep the map layer and the readout use like
 * any decoded one.
 */
import type { Sweep } from "./sweep";
import { azimuthIndex } from "./sweep";

const DEG = Math.PI / 180;

/** Where a sweep's gates are: everything but the data. */
export type Grid = Pick<Sweep, "lat" | "lon" | "heightM" | "time" | "elevation" | "nRadials" | "nGates" | "firstGateKm" | "gateKm" | "azStart" | "azWidth">;

/** Each gate's value times `k` (NaN: no data or a special level such as range folded). */
export function gateValues(s: Sweep, k = 1): Float32Array {
  const lut = Float32Array.from(s.table, (v) => v * k);
  for (const sp of s.special) if (sp.level < lut.length) lut[sp.level] = NaN;
  const out = new Float32Array(s.nRadials * s.nGates);
  for (let i = 0; i < out.length; i++) out[i] = lut[s.data[i]!]!;
  return out;
}

/** Each radial's centre azimuth, degrees. */
export function centres(s: Pick<Sweep, "nRadials" | "azStart" | "azWidth">): Float64Array {
  const c = new Float64Array(s.nRadials);
  for (let r = 0; r < s.nRadials; r++) c[r] = (s.azStart[r]! + s.azWidth[r]! / 2) % 360;
  return c;
}

/**
 * For every gate of `dst`, the gate of `src` under its centre: `radial[r]`
 * (−1: none) and `gate[g]` (−1: out of range), so a value is
 * `srcValues[radial[r] * src.nGates + gate[g]]`.
 */
export function alignTo(src: Grid, dst: Grid): { radial: Int32Array; gate: Int32Array } {
  const lut = azimuthIndex(src);
  const c = centres(dst);
  const radial = new Int32Array(dst.nRadials);
  for (let r = 0; r < dst.nRadials; r++) radial[r] = lut[Math.floor(c[r]! * 10) % 3600]!;
  const gate = new Int32Array(dst.nGates);
  for (let g = 0; g < dst.nGates; g++) {
    const km = dst.firstGateKm + g * dst.gateKm;
    const j = Math.round((km - src.firstGateKm) / src.gateKm);
    gate[g] = j >= 0 && j < src.nGates ? j : -1;
  }
  return { radial, gate };
}

/** `src`'s values on `dst`'s gates (NaN where it has none). */
export function resample(values: Float32Array, src: Grid, dst: Grid): Float32Array {
  const same = src.nRadials === dst.nRadials && src.nGates === dst.nGates && src.firstGateKm === dst.firstGateKm && src.gateKm === dst.gateKm && src.azStart.every((a, i) => a === dst.azStart[i]);
  if (same) return values;
  const { radial, gate } = alignTo(src, dst);
  const out = new Float32Array(dst.nRadials * dst.nGates).fill(NaN);
  for (let r = 0; r < dst.nRadials; r++) {
    const q = radial[r]!;
    if (q < 0) continue;
    for (let g = 0, i = r * dst.nGates, o = q * src.nGates; g < dst.nGates; g++, i++) {
      const j = gate[g]!;
      if (j >= 0) out[i] = values[o + j]!;
    }
  }
  return out;
}

/**
 * Values (NaN: no data) as a sweep on `grid`: levels from 2 in `step`s up
 * from `lo` (0 is no data, 1 left for range folding as in Level II), values
 * past `hi` clamped to it. 8-bit levels when they fit, else 16-bit. The grid's
 * arrays are copied, so the new sweep can be handed to another thread alone.
 */
export function encodeSweep(grid: Grid, values: Float32Array, lo: number, hi: number, step: number, special: Sweep["special"] = []): Sweep {
  const top = 2 + Math.max(0, Math.round((hi - lo) / step));
  const data = top < 256 ? new Uint8Array(values.length) : new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v !== v) continue;
    const l = 2 + Math.round((v - lo) / step);
    data[i] = l < 2 ? 2 : l > top ? top : l;
  }
  const table = new Float32Array(top + 1).fill(NaN);
  for (let l = 2; l <= top; l++) table[l] = lo + (l - 2) * step;
  return {
    lat: grid.lat,
    lon: grid.lon,
    heightM: grid.heightM,
    time: grid.time,
    elevation: grid.elevation,
    nRadials: grid.nRadials,
    nGates: grid.nGates,
    firstGateKm: grid.firstGateKm,
    gateKm: grid.gateKm,
    azStart: grid.azStart.slice(),
    azWidth: grid.azWidth.slice(),
    data,
    table,
    special,
  };
}

/** A copy whose arrays can be moved to another thread while the original stays (cached). */
export function cloneSweep(s: Sweep): Sweep {
  return { ...s, data: s.data.slice(), table: s.table.slice(), azStart: s.azStart.slice(), azWidth: s.azWidth.slice(), ...(s.nyquist && { nyquist: s.nyquist.slice() }) };
}

/** Ground position (km east, km north of the radar) of radial `az` (deg) at slant range `km`. */
export function groundXY(az: number, km: number, elevDeg: number): [number, number] {
  const ground = km * Math.cos(elevDeg * DEG);
  return [ground * Math.sin(az * DEG), ground * Math.cos(az * DEG)];
}
