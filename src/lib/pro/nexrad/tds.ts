/**
 * Tornado debris: a probability-of-debris field (PTDS) and the debris
 * signatures (TDS) in it, from the dual-pol moments plus NROT.
 *
 * Debris lofted by a tornado is big, odd-shaped and tumbling, so it returns
 * a fair echo with very low correlation coefficient and ZDR near zero (or
 * negative), right on the rotation (Ryzhkov et al. 2005; Snyder and Ryzhkov
 * 2015 for the TDS criteria). PTDS is a weighted fuzzy sum of how well each
 * gate fits, as 0–100 %:
 *
 *   reflectivity  ramp 25 → 35 dBZ                        weight 0.30
 *   CC            trapezoid 0, 0.2, 0.85, 0.92            weight 0.40
 *   ZDR           trapezoid −3.5, −2.0, 1.5, 2.5 dB       weight 0.20
 *   |NROT|        ramp 0.5 → 1.5                          weight 0.06
 *   spectrum width ramp 4 → 8 m/s                         weight 0.04
 *
 * The last 10 % are our choice: rotation itself (either sign: anticyclonic
 * tornadoes loft debris too), and a wide spectrum of velocities in the
 * gate, which tornadoes and their debris both give. Echo that isn't weather
 * (birds, insects, ground clutter, chaff) can match the first three almost
 * as well, but only reaches about 90 % without the rotation terms, so the
 * signatures below need more than 95 %. Gates without reflectivity, CC or
 * ZDR have no PTDS; missing velocity or spectrum width counts as 0.
 *
 * TDS detection: along each radial, runs of gates over 95 % at least
 * 0.75 km long; runs within 10 km of each other (nearest of their ends and
 * middles) are one area; areas of at least 9 gates are signatures, and only
 * where |NROT| reaches 1 within 3 km of them, which leaves out
 * non-meteorological echo and debris-like hail or clutter away from any
 * rotation. A signature confirms debris in the air: a tornado has been
 * doing damage. It doesn't prove one is still on the ground, and a weak
 * tornado over open country lofts too little to show.
 */
import { destination } from "../../geo";
import { centres, groundXY, type Grid } from "./polar";

/** 0 at or below a, 1 at or above b, linear between. */
export const ramp = (x: number, a: number, b: number) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a));

/** 0 outside (a, d), 1 on [b, c], linear on the sides. */
export const trapezoid = (x: number, a: number, b: number, c: number, d: number) => (x <= a || x >= d ? 0 : x < b ? (x - a) / (b - a) : x <= c ? 1 : (d - x) / (d - c));

export const PTDS_WEIGHTS = { ref: 0.3, cc: 0.4, zdr: 0.2, nrot: 0.06, sw: 0.04 } as const;

/** How debris-like each input is, 0–1. Spectrum width in m/s. */
export const MEMBERSHIP = {
  ref: (dbz: number) => ramp(dbz, 25, 35),
  cc: (cc: number) => trapezoid(cc, 0, 0.2, 0.85, 0.92),
  zdr: (db: number) => trapezoid(db, -3.5, -2.0, 1.5, 2.5),
  nrot: (n: number) => ramp(Math.abs(n), 0.5, 1.5),
  sw: (ms: number) => ramp(ms, 4, 8),
} as const;

/** PTDS (%) at one gate; NaN without reflectivity, CC or ZDR. Missing NROT or spectrum width counts as 0. */
export function ptdsAt(dbz: number, cc: number, zdr: number, nrot = NaN, swMs = NaN): number {
  if (dbz !== dbz || cc !== cc || zdr !== zdr) return NaN;
  const W = PTDS_WEIGHTS;
  const M = MEMBERSHIP;
  let p = W.ref * M.ref(dbz) + W.cc * M.cc(cc) + W.zdr * M.zdr(zdr);
  if (nrot === nrot) p += W.nrot * M.nrot(nrot);
  if (swMs === swMs) p += W.sw * M.sw(swMs);
  return 100 * p;
}

/** PTDS per gate from the moments on one grid (dBZ, ρhv, dB, NROT, m/s; NaN = none). */
export function ptdsField(ref: Float32Array, cc: Float32Array, zdr: Float32Array, nrot: Float32Array | null, swMs: Float32Array | null): Float32Array {
  const out = new Float32Array(cc.length);
  for (let i = 0; i < out.length; i++) out[i] = ptdsAt(ref[i]!, cc[i]!, zdr[i]!, nrot ? nrot[i]! : NaN, swMs ? swMs[i]! : NaN);
  return out;
}

export const TDS_RULES = {
  /** PTDS a gate needs, %. */
  ptds: 95,
  /** Shortest run along a radial, km. */
  runKm: 0.75,
  /** Runs this close are one area, km. */
  groupKm: 10,
  /** Fewest gates in an area. */
  bins: 9,
  /** |NROT| needed nearby, and how near (km). */
  nrot: 1,
  nrotKm: 3,
} as const;

export interface TdsArea {
  /** Centroid (gate-weighted). */
  lat: number;
  lon: number;
  /** Km east and north of the radar. */
  x: number;
  y: number;
  /** Highest PTDS in it, %. */
  maxPtds: number;
  areaKm2: number;
  bins: number;
  /** Strongest |NROT| within `nrotKm`, signed. */
  nrot: number;
}

interface Run {
  r: number;
  g0: number;
  g1: number;
  /** Ends and middle, km east/north. */
  pts: [number, number][];
}

/** Areas of debris-like gates (see the top of this file). `nrot` is on the same grid; without it nothing is flagged. */
export function findTds(grid: Grid, ptds: Float32Array, nrot: Float32Array | null, rules: Partial<typeof TDS_RULES> = {}): TdsArea[] {
  const rule = { ...TDS_RULES, ...rules };
  if (!nrot) return [];
  const R = grid.nRadials;
  const G = grid.nGates;
  const az = centres(grid);
  const km = (g: number) => grid.firstGateKm + g * grid.gateKm;
  const xy = (r: number, g: number) => groundXY(az[r]!, km(g), grid.elevation);
  const minRun = Math.ceil(rule.runKm / grid.gateKm - 1e-9);

  // ── Runs along each radial ──
  const runs: Run[] = [];
  for (let r = 0; r < R && runs.length < 5000; r++) {
    let start = -1;
    for (let g = 0; g <= G; g++) {
      const hit = g < G && ptds[r * G + g]! > rule.ptds;
      if (hit && start < 0) start = g;
      else if (!hit && start >= 0) {
        if (g - start >= minRun) runs.push({ r, g0: start, g1: g - 1, pts: [xy(r, start), xy(r, (start + g - 1) / 2), xy(r, g - 1)] });
        start = -1;
      }
    }
  }
  if (!runs.length) return [];

  // ── Runs into areas (union-find) ──
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const near = rule.groupKm * rule.groupKm;
  for (let i = 0; i < runs.length; i++) {
    const a = runs[i]!;
    for (let j = i + 1; j < runs.length; j++) {
      const b = runs[j]!;
      // Quick reject on the middles: ends are at most half a run (a few km) from them.
      const [mx, my] = a.pts[1]!;
      const [nx, ny] = b.pts[1]!;
      if (Math.abs(mx - nx) > rule.groupKm + 10 || Math.abs(my - ny) > rule.groupKm + 10) continue;
      let close = false;
      for (const p of a.pts) for (const q of b.pts) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= near) close = true;
      if (close) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Run[]>();
  for (let i = 0; i < runs.length; i++) {
    const k = find(i);
    const list = groups.get(k);
    if (list) list.push(runs[i]!);
    else groups.set(k, [runs[i]!]);
  }

  const out: TdsArea[] = [];
  const cosEl = Math.cos(grid.elevation * (Math.PI / 180));
  for (const list of groups.values()) {
    let bins = 0, sx = 0, sy = 0, area = 0, maxP = 0;
    for (const run of list) {
      const w = grid.azWidth[run.r]! * (Math.PI / 180);
      for (let g = run.g0; g <= run.g1; g++) {
        const [x, y] = xy(run.r, g);
        bins++;
        sx += x;
        sy += y;
        area += grid.gateKm * km(g) * cosEl * w;
        maxP = Math.max(maxP, ptds[run.r * G + g]!);
      }
    }
    if (bins < rule.bins) continue;
    const cx = sx / bins;
    const cy = sy / bins;
    // How far the area reaches from its centroid, then the strongest rotation within nrotKm of that.
    let reach = 0;
    for (const run of list) for (const [x, y] of run.pts) reach = Math.max(reach, Math.hypot(x - cx, y - cy));
    const rot = strongest(grid, nrot, az, cx, cy, reach + rule.nrotKm);
    if (!(Math.abs(rot) >= rule.nrot)) continue;
    const dist = Math.hypot(cx, cy);
    const at = destination({ lat: grid.lat, lon: grid.lon }, (Math.atan2(cx, cy) * 180) / Math.PI, dist);
    out.push({ lat: at.lat, lon: at.lon, x: cx, y: cy, maxPtds: maxP, areaKm2: area, bins, nrot: rot });
  }
  return out.sort((a, b) => b.maxPtds - a.maxPtds || b.bins - a.bins);
}

/** The NROT of largest magnitude (signed) within `radius` km of (x, y); NaN if none. */
function strongest(grid: Grid, nrot: Float32Array, az: Float64Array, x: number, y: number, radius: number): number {
  const G = grid.nGates;
  const cosEl = Math.cos(grid.elevation * (Math.PI / 180));
  const dist = Math.hypot(x, y);
  const bearing = (Math.atan2(x, y) * 180) / Math.PI;
  const span = dist > radius ? (Math.asin(radius / dist) * 180) / Math.PI : 180;
  const gLo = Math.max(0, Math.floor(((dist - radius) / cosEl - grid.firstGateKm) / grid.gateKm));
  const gHi = Math.min(G - 1, Math.ceil(((dist + radius) / cosEl - grid.firstGateKm) / grid.gateKm));
  let best = NaN;
  for (let r = 0; r < grid.nRadials; r++) {
    const off = Math.abs(((az[r]! - bearing + 540) % 360) - 180);
    if (off > span + grid.azWidth[r]!) continue;
    for (let g = gLo; g <= gHi; g++) {
      const v = nrot[r * G + g]!;
      if (v !== v || (best === best && Math.abs(v) <= Math.abs(best))) continue;
      const [px, py] = groundXY(az[r]!, grid.firstGateKm + g * grid.gateKm, grid.elevation);
      if ((px - x) ** 2 + (py - y) ** 2 <= radius * radius) best = v;
    }
  }
  return best;
}
