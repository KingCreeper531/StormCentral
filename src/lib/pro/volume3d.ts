/**
 * The 3D volume view (components/pro/volume-panel): every tilt of a Level II
 * volume as points in space around a spot, at the height the beam really
 * reaches (4/3-earth refraction), so a storm's structure (its core, overhang,
 * bounded weak echo region, how high the hail core goes) can be seen from any
 * side. Heights are above mean sea level, like echo tops and the model's
 * freezing level.
 *
 * Coordinates are kilometres in a local frame centred on the spot: x east,
 * y north, z up from sea level. Pure; the renderer is volume-canvas.tsx.
 */
import type { LatLon } from "../geo";
import { azimuthIndex, slantRange, type Sweep } from "./nexrad/sweep";
import { scaleColor, type ValueScale } from "./scales";
import type { Sounding } from "./thermo";

const R_EARTH_KM = 6371.0088;
/** 4/3 effective earth radius for standard beam refraction. */
const KA = (4 / 3) * R_EARTH_KM;
const DEG = Math.PI / 180;

/** Ground distance and height above the antenna (km) of a gate at slant range `r` on a beam at `elevDeg`. */
export function beamPosition(r: number, elevDeg: number): { ground: number; height: number } {
  const e = elevDeg * DEG;
  const height = Math.sqrt(r * r + KA * KA + 2 * r * KA * Math.sin(e)) - KA;
  const ground = KA * Math.asin((r * Math.cos(e)) / (KA + height));
  return { ground, height };
}

export interface VolumePoints {
  /** x, y, z (km) per point. */
  positions: Float32Array;
  /** r, g, b per point. */
  colors: Uint8Array;
  /** About how wide each point's gate is (km), so points join up into solid echo. */
  sizes: Float32Array;
  values: Float32Array;
  count: number;
  /** Every n-th gate and radial was kept (1: all of them). */
  stride: number;
  /** The radar's position in the local frame and its antenna height (km). */
  radar: { x: number; y: number; z: number };
}

export interface VolumeOptions {
  focus: LatLon;
  radiusKm: number;
  /** Gates below this value are left out. */
  threshold: number;
  scale: ValueScale & { clearBelow?: boolean };
  /** Past this many points, gates and radials are thinned evenly. */
  maxPoints?: number;
  /**
   * Fill the gap between neighbouring tilts where both have echo over the
   * threshold, with values blended between them (the tilts are a degree or
   * more apart, so far from the radar a storm is otherwise a stack of slices).
   */
  fill?: boolean;
}

/** Gaps between tilts taller than this (km) are left open: too far apart to guess what's between. */
export const MAX_FILL_KM = 4;
/** The beam is about this wide (degrees), so filled points are spaced by its depth at that range. */
export const BEAM_DEG = 0.95;

export const MAX_POINTS = 600_000;

/** Where the spot is from the radar: east and north (km) in the radar's azimuthal frame. */
export function focusFromRadar(radar: LatLon, p: LatLon): { x: number; y: number } {
  const lat1 = radar.lat * DEG;
  const lat2 = p.lat * DEG;
  const dLon = (p.lon - radar.lon) * DEG;
  const c = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const d = Math.acos(Math.min(1, Math.max(-1, c))) * R_EARTH_KM;
  const az = Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
  return { x: d * Math.sin(az), y: d * Math.cos(az) };
}

/** The gates of each sweep near the spot (and the filled gaps above them), as `visit(x, y, z, size, value)` calls. Returns how many there were. */
function walk(sweeps: readonly Sweep[], o: VolumeOptions, stride: number, visit: ((x: number, y: number, z: number, size: number, value: number) => void) | null): number {
  let n = 0;
  const r2 = o.radiusKm * o.radiusKm;
  const emit = (x: number, y: number, z: number, size: number, v: number) => {
    n++;
    visit?.(x, y, z, size, v);
  };
  // The tilt above each one, for filling (its azimuth lookup made once).
  const above = o.fill ? sweeps.map((_, i) => sweeps[i + 1]) : [];
  const luts = new Map<Sweep, Int32Array>();
  const lut = (s: Sweep) => {
    let l = luts.get(s);
    if (!l) luts.set(s, (l = azimuthIndex(s)));
    return l;
  };
  sweeps.forEach((s, si) => {
    const f = focusFromRadar(s, o.focus);
    const dist = Math.hypot(f.x, f.y);
    const zRadar = s.heightM / 1000;
    // Gates within reach of the circle, by ground range.
    const nearKm = Math.max(0, dist - o.radiusKm);
    const farKm = dist + o.radiusKm;
    const ground = new Float32Array(s.nGates);
    const height = new Float32Array(s.nGates);
    let g0 = s.nGates;
    let g1 = -1;
    for (let g = 0; g < s.nGates; g++) {
      const p = beamPosition(s.firstGateKm + g * s.gateKm, s.elevation);
      ground[g] = p.ground;
      height[g] = p.height;
      if (p.ground >= nearKm && p.ground <= farKm) {
        if (g < g0) g0 = g;
        g1 = g;
      }
    }
    if (g1 < g0) return;
    const up = above[si];
    const upLut = up ? lut(up) : null;
    // Radials pointing at the circle (all of them when the radar is inside it).
    const half = dist > o.radiusKm ? Math.asin(o.radiusKm / dist) / DEG + 1 : 180;
    const focusAz = (Math.atan2(f.x, f.y) / DEG + 360) % 360;
    for (let i = 0; i < s.nRadials; i += stride) {
      const az = s.azStart[i]! + s.azWidth[i]! / 2;
      const off = Math.abs(((az - focusAz + 540) % 360) - 180);
      if (off > half) continue;
      const sin = Math.sin(az * DEG);
      const cos = Math.cos(az * DEG);
      const wideRad = s.azWidth[i]! * stride * DEG;
      const row = i * s.nGates;
      const upRadial = upLut ? upLut[Math.floor((((az % 360) + 360) % 360) * 10) % 3600]! : -1;
      for (let g = g0; g <= g1; g += stride) {
        const v = s.table[s.data[row + g]!]!;
        if (!(v >= o.threshold)) continue;
        const x = ground[g]! * sin - f.x;
        const y = ground[g]! * cos - f.y;
        if (x * x + y * y > r2) continue;
        const size = Math.max(s.gateKm * stride, ground[g]! * wideRad);
        const z = zRadar + height[g]!;
        emit(x, y, z, size, v);
        // The same spot on the tilt above: fill between when it has echo too.
        if (!up || upRadial < 0) continue;
        const slant = slantRange(ground[g]!, up.elevation);
        const ug = Math.round((slant - up.firstGateKm) / up.gateKm);
        if (!(ug >= 0 && ug < up.nGates)) continue;
        const uv = up.table[up.data[upRadial * up.nGates + ug]!]!;
        if (!(uv >= o.threshold)) continue;
        const dz = beamPosition(slant, up.elevation).height + up.heightM / 1000 - z;
        const depth = Math.max(0.25, ground[g]! * BEAM_DEG * DEG);
        if (!(dz > depth) || dz > MAX_FILL_KM) continue;
        const steps = Math.ceil(dz / depth);
        for (let k = 1; k < steps; k++) emit(x, y, z + (dz * k) / steps, size, v + ((uv - v) * k) / steps);
      }
    }
  });
  return n;
}

/** The volume's echo at or above the threshold within the circle around the spot. */
export function volumePoints(sweeps: readonly Sweep[], o: VolumeOptions): VolumePoints {
  const max = o.maxPoints ?? MAX_POINTS;
  let stride = 1;
  let count = walk(sweeps, o, 1, null);
  // Thinning both ways divides the count by about stride².
  while (count > max && stride < 8) {
    stride *= 2;
    count = walk(sweeps, o, stride, null);
  }
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);
  const sizes = new Float32Array(count);
  const values = new Float32Array(count);
  let k = 0;
  walk(sweeps, o, stride, (x, y, z, size, v) => {
    if (k >= count) return;
    positions[k * 3] = x;
    positions[k * 3 + 1] = y;
    positions[k * 3 + 2] = z;
    const c = scaleColor(o.scale, v) ?? [128, 128, 128];
    colors.set(c, k * 3);
    sizes[k] = size;
    values[k] = v;
    k++;
  });
  const first = sweeps[0];
  const r = first ? focusFromRadar(first, o.focus) : { x: 0, y: 0 };
  return { positions, colors, sizes, values, count: k, stride, radar: { x: -r.x, y: -r.y, z: (first?.heightM ?? 0) / 1000 } };
}

/**
 * Lines on the ground (lon/lat, a GeoJSON MultiLineString's coordinates) in
 * the square of half-width `half` around the spot, clipped to it, as segment
 * ends x, y, z (km) in the local frame at height `z`.
 */
export function groundLines(lines: readonly (readonly (readonly number[])[])[], radar: LatLon, focus: LatLon, half: number, z: number): Float32Array {
  const f = focusFromRadar(radar, focus);
  // A loose box in degrees first: most of the country is nowhere near.
  const dLat = (half * 1.5) / 111;
  const dLon = dLat / Math.max(0.2, Math.cos(focus.lat * DEG));
  const local = (c: readonly number[]) => {
    const p = focusFromRadar(radar, { lat: c[1]!, lon: c[0]! });
    return { x: p.x - f.x, y: p.y - f.y };
  };
  const out: number[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      // Both ends past the same side of the box: the segment can't cross it.
      if (Math.min(a[1]!, b[1]!) > focus.lat + dLat || Math.max(a[1]!, b[1]!) < focus.lat - dLat) continue;
      if (Math.min(a[0]!, b[0]!) > focus.lon + dLon || Math.max(a[0]!, b[0]!) < focus.lon - dLon) continue;
      const p = local(a);
      const q = local(b);
      const s = clipSegment(p.x, p.y, q.x, q.y, half);
      if (s) out.push(s[0], s[1], z, s[2], s[3], z);
    }
  }
  return new Float32Array(out);
}

/** The part of a segment inside the square |x|, |y| ≤ h (Liang–Barsky), or null. */
function clipSegment(x0: number, y0: number, x1: number, y1: number, h: number): [number, number, number, number] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let a = 0;
  let b = 1;
  for (const [p, q] of [
    [-dx, x0 + h],
    [dx, h - x0],
    [-dy, y0 + h],
    [dy, h - y0],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
    } else if (p < 0) a = Math.max(a, q / p);
    else b = Math.min(b, q / p);
    if (a > b) return null;
  }
  return [x0 + a * dx, y0 + a * dy, x0 + b * dx, y0 + b * dy];
}

/** The highest point (km above sea level) with a value at or above `min`, or null. */
export function topOf(p: VolumePoints, min: number): number | null {
  let top = -Infinity;
  for (let i = 0; i < p.count; i++) if (p.values[i]! >= min && p.positions[i * 3 + 2]! > top) top = p.positions[i * 3 + 2]!;
  return Number.isFinite(top) ? top : null;
}

/**
 * Heights (km above sea level) where the model sounding first cools through
 * 0 °C and −20 °C going up: the melting level, and the top of the layer where
 * hail grows fastest. null where the profile doesn't reach it.
 */
export function freezingLevels(s: Sounding | null): { zero: number | null; minus20: number | null } {
  const at = (tc: number): number | null => {
    if (!s) return null;
    const lv = s.levels;
    if (lv[0] && lv[0].t <= tc) return lv[0].z / 1000;
    for (let i = 1; i < lv.length; i++) {
      const a = lv[i - 1]!;
      const b = lv[i]!;
      if (a.t > tc && b.t <= tc) return (a.z + ((a.t - tc) / (a.t - b.t)) * (b.z - a.z)) / 1000;
    }
    return null;
  };
  return { zero: at(0), minus20: at(-20) };
}

/** Height scale ticks up to `topKm`: every 10 kft (5 under 20 kft) in feet, every 2 km (1 under 6 km) in metres. */
export function heightTicks(topKm: number, imperial: boolean): { km: number; label: string }[] {
  const ticks: { km: number; label: string }[] = [];
  if (imperial) {
    const topKft = topKm * 3.28084;
    const step = topKft < 20 ? 5 : 10;
    for (let k = 0; k <= topKft + 1e-9; k += step) ticks.push({ km: k / 3.28084, label: `${k}` });
  } else {
    const step = topKm < 6 ? 1 : 2;
    for (let k = 0; k <= topKm + 1e-9; k += step) ticks.push({ km: k, label: `${k}` });
  }
  return ticks;
}

/** A height for people to read: kft (one decimal) or km. */
export const formatHeight = (km: number, imperial: boolean) => (imperial ? `${(km * 3.28084).toFixed(1)} kft` : `${km.toFixed(1)} km`);
