/**
 * Shaded surfaces for the 3D volume view (components/pro/volume-panel): the
 * polar volume resampled onto a regular grid in the view's local frame (km,
 * x east, y north, z above sea level, as lib/pro/volume3d), then a closed
 * shell at each chosen value by marching cubes, with smooth normals from the
 * field's gradient.
 *
 * Between tilts values are blended by height (gaps over MAX_FILL_KM stay
 * open, as the points view does); each tilt also covers half its beam's depth
 * above and below. The grid's outer nodes are kept empty so every shell
 * closes, at the box's walls too.
 *
 * Pure; runs in isosurface.worker.ts.
 */
import type { LatLon } from "../geo";
import { azimuthIndex, slantRange, type Sweep } from "./nexrad/sweep";
import { scaleColor, type ValueScale } from "./scales";
import { BEAM_DEG, beamPosition, focusFromRadar, MAX_FILL_KM } from "./volume3d";

const DEG = Math.PI / 180;
export const MS_TO_KT = 1.943844;

/** A regular grid of values; node (i, j, k) is at x0 + i·step, y0 + j·step, z0 + k·dz. */
export interface Grid {
  nx: number;
  ny: number;
  nz: number;
  x0: number;
  y0: number;
  z0: number;
  step: number;
  dz: number;
  /** x fastest, then y, then z. */
  values: Float32Array;
}

/** The box the surfaces are built in around the spot. */
export interface SurfaceBox {
  /** Half its width (km). */
  half: number;
  /** Node spacing across and up (km). */
  step: number;
  dz: number;
  /** Top (km above sea level). */
  top: number;
}

/** The box isn't wider than this (km): about 120 nodes across at most. */
export const MAX_BOX_KM = 120;
export const BOX_TOP_KM = 18;

/** The surfaces' box for the view's radius: as wide as the view up to MAX_BOX_KM, every 0.5 km up to 60 km wide, every 1 km past that. */
export function surfaceBox(radiusKm: number): SurfaceBox {
  const width = Math.min(2 * radiusKm, MAX_BOX_KM);
  return { half: width / 2, step: width <= 60 ? 0.5 : 1, dz: 0.5, top: BOX_TOP_KM };
}

export interface GridOptions extends SurfaceBox {
  focus: LatLon;
  /** The value where there's no data, which shells close against. */
  missing: number;
  /** Values below `missing` count as it (reflectivity: weaker echo is as good as none). */
  clamp?: boolean;
  /** Blend each node 1-2-1 with its neighbours across, to take the edge off gate-sized steps. */
  smooth?: boolean;
}

/** The volume (sweeps lowest tilt first, as decoded) on a grid around the spot. */
export function resample(sweeps: readonly Sweep[], o: GridOptions): Grid {
  const nx = Math.round((2 * o.half) / o.step) + 1;
  const ny = nx;
  const z0 = (sweeps[0]?.heightM ?? 0) / 1000;
  const nz = Math.max(3, Math.floor((o.top - z0) / o.dz) + 1);
  const values = new Float32Array(nx * ny * nz).fill(o.missing);
  const grid: Grid = { nx, ny, nz, x0: -o.half, y0: -o.half, z0, step: o.step, dz: o.dz, values };
  if (!sweeps.length) return grid;
  const luts = sweeps.map(azimuthIndex);
  const from = sweeps.map((s) => focusFromRadar(s, o.focus));
  // Per column: each tilt's height there, its value and half its beam's depth.
  const n = sweeps.length;
  const h = new Float64Array(n);
  const v = new Float64Array(n);
  const hw = new Float64Array(n);
  for (let j = 0; j < ny; j++) {
    const y = -o.half + j * o.step;
    for (let i = 0; i < nx; i++) {
      const x = -o.half + i * o.step;
      let m = 0;
      for (let k = 0; k < n; k++) {
        const s = sweeps[k]!;
        const rx = x + from[k]!.x;
        const ry = y + from[k]!.y;
        const slant = slantRange(Math.hypot(rx, ry), s.elevation);
        if (!Number.isFinite(slant)) continue;
        let val = o.missing;
        const gate = Math.round((slant - s.firstGateKm) / s.gateKm);
        if (gate >= 0 && gate < s.nGates) {
          const az = ((Math.atan2(rx, ry) / DEG) + 360) % 360;
          const r = luts[k]![Math.floor(az * 10) % 3600]!;
          if (r >= 0) {
            const raw = s.table[s.data[r * s.nGates + gate]!]!;
            if (!Number.isNaN(raw)) val = o.clamp && raw < o.missing ? o.missing : raw;
          }
        }
        h[m] = beamPosition(slant, s.elevation).height + s.heightM / 1000;
        v[m] = val;
        hw[m] = Math.max((slant * BEAM_DEG * DEG) / 2, o.dz * 0.6);
        m++;
      }
      if (!m) continue;
      let k = 0;
      for (let kz = 0; kz < nz; kz++) {
        const z = z0 + kz * o.dz;
        while (k < m - 1 && h[k + 1]! <= z) k++;
        let val = o.missing;
        if (z < h[0]!) {
          if (z >= h[0]! - hw[0]!) val = v[0]!;
        } else if (k === m - 1) {
          if (z <= h[k]! + hw[k]!) val = v[k]!;
        } else {
          const gap = h[k + 1]! - h[k]!;
          if (gap <= MAX_FILL_KM) val = v[k]! + ((v[k + 1]! - v[k]!) * (z - h[k]!)) / gap;
          else if (z <= h[k]! + hw[k]!) val = v[k]!;
          else if (z >= h[k + 1]! - hw[k + 1]!) val = v[k + 1]!;
        }
        values[(kz * ny + j) * nx + i] = val;
      }
    }
  }
  if (o.smooth) smoothAcross(grid);
  // Empty outer nodes: the shells close at the box's walls, floor and top.
  for (let kz = 0; kz < nz; kz++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) if (kz === 0 || kz === nz - 1 || j === 0 || j === ny - 1 || i === 0 || i === nx - 1) values[(kz * ny + j) * nx + i] = o.missing;
  return grid;
}

/** 1-2-1 along x, then along y, on every level. */
function smoothAcross(g: Grid) {
  const { nx, ny, nz, values } = g;
  const row = new Float32Array(Math.max(nx, ny));
  for (let kz = 0; kz < nz; kz++) {
    const lv = kz * nx * ny;
    for (let j = 0; j < ny; j++) {
      const at = lv + j * nx;
      for (let i = 0; i < nx; i++) row[i] = values[at + i]!;
      for (let i = 1; i < nx - 1; i++) values[at + i] = (row[i - 1]! + 2 * row[i]! + row[i + 1]!) / 4;
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) row[j] = values[lv + j * nx + i]!;
      for (let j = 1; j < ny - 1; j++) values[lv + j * nx + i] = (row[j - 1]! + 2 * row[j]! + row[j + 1]!) / 4;
    }
  }
}

/** The highest point (km above sea level) where the grid reaches `min`, between nodes, or null. */
export function gridTop(g: Grid, min: number): number | null {
  const { nx, ny, nz, values } = g;
  let top = -Infinity;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      for (let k = nz - 2; k >= 0; k--) {
        const a = values[(k * ny + j) * nx + i]!;
        if (a < min) continue;
        const b = values[((k + 1) * ny + j) * nx + i]!;
        const z = g.z0 + (k + (b < min ? (a - min) / (a - b) : 1)) * g.dz;
        if (z > top) top = z;
        break;
      }
  return Number.isFinite(top) ? top : null;
}

// ── Marching cubes ──────────────────────────────────────────────────────────

/**
 * A cell's corner c sits at (c & 1, c >> 1 & 1, c >> 2 & 1). Edge e joins
 * corner EDGES[e][0] and the next one along axis EDGES[e][1].
 */
const EDGES: [number, number][] = [];
for (let c = 0; c < 8; c++) for (let axis = 0; axis < 3; axis++) if (!(c & (1 << axis))) EDGES.push([c, axis]);
const edgeBetween = (a: number, b: number) => EDGES.findIndex(([c, axis]) => c === Math.min(a, b) && 1 << axis === (a ^ b));

/**
 * The triangles (as edge numbers, three a triangle) for each of the 256 ways
 * a cell's corners can be in or out, worked out here rather than typed in:
 * on each face the crossed edges are joined in pairs (where a face has two
 * corners in, diagonally, each in corner is cut off on its own; neighbouring
 * cells see the same face the same way, so the shells have no holes), the
 * pairs chain into loops round the cell, and each loop is fanned into
 * triangles wound to face out, towards lower values.
 */
const TABLE = (() => {
  const corner = (c: number) => [c & 1, (c >> 1) & 1, (c >> 2) & 1];
  const faces: number[][] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const side of [0, 1]) {
      const [u, w] = [0, 1, 2].filter((a) => a !== axis).map((a) => 1 << a);
      const base = side << axis;
      faces.push([base, base | u!, base | u! | w!, base | w!]);
    }
  const start = new Uint16Array(257);
  const edges: number[] = [];
  for (let mask = 0; mask < 256; mask++) {
    start[mask] = edges.length;
    const inside = (c: number) => (mask >> c) & 1;
    const links = new Map<number, number[]>();
    const link = (a: number, b: number) => {
      links.set(a, [...(links.get(a) ?? []), b]);
      links.set(b, [...(links.get(b) ?? []), a]);
    };
    for (const f of faces) {
      const crossed = [0, 1, 2, 3].filter((k) => inside(f[k]!) !== inside(f[(k + 1) % 4]!)).map((k) => edgeBetween(f[k]!, f[(k + 1) % 4]!));
      if (crossed.length === 2) link(crossed[0]!, crossed[1]!);
      else if (crossed.length === 4)
        for (let k = 0; k < 4; k++) if (inside(f[k]!)) link(edgeBetween(f[(k + 3) % 4]!, f[k]!), edgeBetween(f[k]!, f[(k + 1) % 4]!));
    }
    const seen = new Set<number>();
    for (const first of links.keys()) {
      if (seen.has(first)) continue;
      const loop: number[] = [];
      let prev = -1;
      let at = first;
      do {
        loop.push(at);
        seen.add(at);
        const [p, q] = links.get(at)!;
        const next = p !== prev ? p! : q!;
        prev = at;
        at = next;
      } while (at !== first);
      // Newell's normal of the loop through the edges' midpoints, against the way from in to out.
      const mid = loop.map((e) => {
        const [c, axis] = EDGES[e]!;
        const p = corner(c);
        p[axis] = p[axis]! + 0.5;
        return p;
      });
      const n: [number, number, number] = [0, 0, 0];
      mid.forEach((p, i) => {
        const q = mid[(i + 1) % mid.length]!;
        n[0] += (p[1]! - q[1]!) * (p[2]! + q[2]!);
        n[1] += (p[2]! - q[2]!) * (p[0]! + q[0]!);
        n[2] += (p[0]! - q[0]!) * (p[1]! + q[1]!);
      });
      let out = 0;
      for (const e of loop) {
        const [c, axis] = EDGES[e]!;
        // Along the edge's axis from its in corner to its out one.
        out += n[axis]! * (inside(c) ? 1 : -1);
      }
      if (out < 0) loop.reverse();
      for (let i = 1; i < loop.length - 1; i++) edges.push(loop[0]!, loop[i]!, loop[i + 1]!);
    }
  }
  start[256] = edges.length;
  return { start, edges: Uint8Array.from(edges) };
})();

export interface Mesh {
  /** x, y, z (km) per vertex. */
  positions: Float32Array;
  /** Unit normals per vertex, facing out of the shell (towards lower values). */
  normals: Float32Array;
  /** Three vertices a triangle, wound anticlockwise seen from outside. */
  indices: Uint32Array;
  /** The highest vertex (km above sea level), or null for an empty shell. */
  top: number | null;
}

/** Grows typed arrays by doubling. */
class Buf<T extends Float32Array | Uint32Array> {
  n = 0;
  a: T;
  private make: (n: number) => T;
  constructor(a: T, make: (n: number) => T) {
    this.a = a;
    this.make = make;
  }
  push3(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) {
      const b = this.make(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  done = () => this.a.slice(0, this.n) as T;
}

/**
 * The shell where the grid crosses `iso`, enclosing values at or above it
 * (with `sign` −1, at or below −iso: inbound velocity, say).
 */
export function marchingCubes(g: Grid, iso: number, sign: 1 | -1 = 1): Mesh {
  const { nx, ny, nz, step, dz } = g;
  const values = sign === 1 ? g.values : g.values.map((v) => -v);
  const sy = nx;
  const sz = nx * ny;
  const offset = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => (c & 1) + ((c >> 1) & 1) * sy + ((c >> 2) & 1) * sz);
  const along = [1, sy, sz];
  const spacing = [step, step, dz];
  // The vertex on each crossed grid edge, so neighbouring cells share it: node × 3 + axis.
  const vertexAt = new Int32Array(nx * ny * nz * 3).fill(-1);
  const pos = new Buf(new Float32Array(3 * 4096), (n) => new Float32Array(n));
  const nor = new Buf(new Float32Array(3 * 4096), (n) => new Float32Array(n));
  const idx = new Buf(new Uint32Array(3 * 8192), (n) => new Uint32Array(n));
  let count = 0;
  let top = -Infinity;
  const gradient = (node: number, out: number[], w: number) => {
    const i = node % nx;
    const j = Math.floor(node / nx) % ny;
    const k = Math.floor(node / sz);
    const d = (at: number, n: number, s: number, h: number) => {
      const lo = at > 0 ? node - s : node;
      const hi = at < n - 1 ? node + s : node;
      return ((values[hi]! - values[lo]!) / ((at > 0 ? 1 : 0) + (at < n - 1 ? 1 : 0) || 1)) / h;
    };
    out[0]! += w * d(i, nx, 1, step);
    out[1]! += w * d(j, ny, sy, step);
    out[2]! += w * d(k, nz, sz, dz);
  };
  const vertex = (base: number, e: number): number => {
    const [c, axis] = EDGES[e]!;
    const node = base + offset[c]!;
    const key = node * 3 + axis;
    const have = vertexAt[key]!;
    if (have >= 0) return have;
    const other = node + along[axis]!;
    const a = values[node]!;
    const b = values[other]!;
    const t = b === a ? 0.5 : Math.min(1, Math.max(0, (iso - a) / (b - a)));
    const p = [g.x0 + (node % nx) * step, g.y0 + (Math.floor(node / nx) % ny) * step, g.z0 + Math.floor(node / sz) * dz];
    p[axis]! += t * spacing[axis]!;
    pos.push3(p[0]!, p[1]!, p[2]!);
    if (p[2]! > top) top = p[2]!;
    // Out of the shell is down the gradient.
    const n = [0, 0, 0];
    gradient(node, n, 1 - t);
    gradient(other, n, t);
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    nor.push3(-n[0]! / l, -n[1]! / l, -n[2]! / l);
    vertexAt[key] = count;
    return count++;
  };
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++) {
      let base = (k * ny + j) * nx;
      for (let i = 0; i < nx - 1; i++, base++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) if (values[base + offset[c]!]! >= iso) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue;
        for (let t = TABLE.start[mask]!; t < TABLE.start[mask + 1]!; t += 3) idx.push3(vertex(base, TABLE.edges[t]!), vertex(base, TABLE.edges[t + 1]!), vertex(base, TABLE.edges[t + 2]!));
      }
    }
  return { positions: pos.done(), normals: nor.done(), indices: idx.done(), top: count ? top : null };
}

// ── Colours ─────────────────────────────────────────────────────────────────

export type Rgb = [number, number, number];

/** A reflectivity shell's colour (0–1): the palette's at its threshold. */
export function shellColor(scale: ValueScale & { clearBelow?: boolean }, dbz: number): Rgb {
  const c = scaleColor(scale, dbz) ?? [160, 160, 160];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/** Velocity shells: towards the radar green, away red, as velocity is drawn. */
export const INBOUND: Rgb = [0.12, 0.86, 0.32];
export const OUTBOUND: Rgb = [0.96, 0.18, 0.2];

// ── All of it at once (the worker's job) ────────────────────────────────────

export interface SurfaceRequest {
  focus: LatLon;
  radiusKm: number;
  /** Reflectivity shells (dBZ). */
  levels: number[];
  /** Velocity shells at ± this (m/s), or null for none. */
  velocityMs: number | null;
}

export interface SurfaceSet {
  box: SurfaceBox;
  /** The request's levels, and a shell for each. */
  levels: number[];
  ref: Mesh[];
  vel: { inbound: Mesh; outbound: Mesh } | null;
  /** The top of the 50 dBZ core (km above sea level), or null. */
  top50: number | null;
  /** How long the build took (ms). */
  ms: number;
}

/** Grid the reflectivity volume (and the velocity one, if asked) and build every shell. */
export function buildSurfaces(ref: readonly Sweep[], vel: readonly Sweep[] | null, req: SurfaceRequest): SurfaceSet {
  const t0 = performance.now();
  const box = surfaceBox(req.radiusKm);
  const grid = resample(ref, { ...box, focus: req.focus, missing: 0, clamp: true, smooth: true });
  const meshes = req.levels.map((dbz) => marchingCubes(grid, dbz));
  let v: SurfaceSet["vel"] = null;
  if (vel && req.velocityMs != null) {
    // The decoded table is in knots.
    const kt = req.velocityMs * MS_TO_KT;
    const g = resample(vel, { ...box, focus: req.focus, missing: 0, smooth: true });
    v = { inbound: marchingCubes(g, kt, -1), outbound: marchingCubes(g, kt) };
  }
  return { box, levels: [...req.levels], ref: meshes, vel: v, top50: gridTop(grid, 50), ms: performance.now() - t0 };
}

/** The meshes' buffers, to hand over from the worker without copying. */
export function surfaceBuffers(s: SurfaceSet): ArrayBuffer[] {
  const meshes = [...s.ref, ...(s.vel ? [s.vel.inbound, s.vel.outbound] : [])];
  return meshes.flatMap((m) => [m.positions.buffer, m.normals.buffer, m.indices.buffer] as ArrayBuffer[]);
}

// ── Worker messages ─────────────────────────────────────────────────────────

export type SurfaceMessage = {
  id: number;
  /** The volumes the worker should keep from now on (it keeps a few, by key). */
  volumes: { key: string; sweeps: Sweep[] }[];
  ref: string;
  vel: string | null;
  req: SurfaceRequest;
};

export type SurfaceReply = { id: number; ok: true; set: SurfaceSet } | { id: number; ok: false; error: string; missing?: boolean };
