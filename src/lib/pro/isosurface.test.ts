import { describe, expect, it } from "vitest";
import { buildSurfaces, gridTop, INBOUND, marchingCubes, MAX_BOX_KM, OUTBOUND, resample, shellColor, surfaceBox, type Grid } from "./isosurface";
import { slantRange, type Sweep } from "./nexrad/sweep";
import { DECODED_SCALES, scaleColor } from "./scales";
import { BEAM_DEG, beamPosition } from "./volume3d";

const RADAR = { lat: 35.333, lon: -97.278 };
const KM_PER_DEG_LON = 111.32 * Math.cos((RADAR.lat * Math.PI) / 180);
/** `km` due east of the radar. */
const east = (km: number) => ({ lat: RADAR.lat, lon: RADAR.lon + km / KM_PER_DEG_LON });

/**
 * A made-up sweep: `nRadials` radials and `gateKm` gates, raw level =
 * 2 × value + `offset` (66 as Level II reflectivity), `echo(az, slantKm)`
 * giving each gate's value (null: none).
 */
function sweep(elevation: number, echo: (az: number, km: number) => number | null, o: { nRadials?: number; nGates?: number; gateKm?: number; offset?: number } = {}): Sweep {
  const nRadials = o.nRadials ?? 360;
  const offset = o.offset ?? 66;
  const gateKm = o.gateKm ?? 1;
  const nGates = o.nGates ?? 160;
  const width = 360 / nRadials;
  const data = new Uint8Array(nRadials * nGates);
  for (let r = 0; r < nRadials; r++)
    for (let g = 0; g < nGates; g++) {
      const v = echo((r + 0.5) * width, gateKm / 2 + g * gateKm);
      if (v != null) data[r * nGates + g] = Math.max(2, Math.min(255, Math.round(v * 2 + offset)));
    }
  const table = new Float32Array(256).fill(NaN);
  for (let i = 2; i < 256; i++) table[i] = (i - offset) / 2;
  return {
    ...RADAR,
    heightM: 370,
    time: 0,
    elevation,
    nRadials,
    nGates,
    firstGateKm: gateKm / 2,
    gateKm,
    azStart: Float32Array.from({ length: nRadials }, (_, i) => i * width),
    azWidth: new Float32Array(nRadials).fill(width),
    data,
    table,
    special: [{ level: 1, label: "RF" }],
  };
}

/** A grid of `f(x, y, z)` over a cube of half-width `half`, spaced `step`. */
function field(half: number, step: number, f: (x: number, y: number, z: number) => number): Grid {
  const n = Math.round((2 * half) / step) + 1;
  const values = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values[(k * n + j) * n + i] = f(-half + i * step, -half + j * step, -half + k * step);
  return { nx: n, ny: n, nz: n, x0: -half, y0: -half, z0: -half, step, dz: step, values };
}

describe("marchingCubes", () => {
  const R = 6;
  // Higher inside: the shell encloses values at or above 0.
  const sphere = field(10, 0.5, (x, y, z) => R - Math.hypot(x, y, z - 0.3));

  it("puts a sphere's vertices on it, with a sane count, and normals facing out", () => {
    const m = marchingCubes(sphere, 0);
    const n = m.positions.length / 3;
    // About one vertex per cell the surface crosses: area / step², give or take.
    const area = 4 * Math.PI * R * R;
    expect(n).toBeGreaterThan(area / 0.25);
    expect(n).toBeLessThan((3 * area) / 0.25);
    for (let i = 0; i < n; i++) {
      const p = [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]! - 0.3];
      const r = Math.hypot(p[0]!, p[1]!, p[2]!);
      expect(Math.abs(r - R)).toBeLessThan(0.05);
      const nn = [m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!];
      expect(Math.hypot(nn[0]!, nn[1]!, nn[2]!)).toBeCloseTo(1, 4);
      // Outward: along the radius.
      expect((nn[0]! * p[0]! + nn[1]! * p[1]! + nn[2]! * p[2]!) / r).toBeGreaterThan(0.98);
    }
    expect(m.top).toBeCloseTo(R + 0.3, 1);
  });

  it("winds every triangle to face out, and leaves no holes", () => {
    const m = marchingCubes(sphere, 0);
    const edges = new Map<string, number>();
    const P = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]! - 0.3];
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      const [pa, pb, pc] = [P(a), P(b), P(c)];
      const u = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
      const v = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      expect(n[0]! * pa[0]! + n[1]! * pa[1]! + n[2]! * pa[2]!).toBeGreaterThanOrEqual(0);
      // Each directed edge once; its reverse belongs to the neighbouring triangle.
      for (const [x, y] of [[a, b], [b, c], [c, a]] as const) edges.set(`${x}>${y}`, (edges.get(`${x}>${y}`) ?? 0) + 1);
    }
    for (const [k, n] of edges) {
      expect(n).toBe(1);
      const [x, y] = k.split(">");
      expect(edges.has(`${y}>${x}`)).toBe(true);
    }
  });

  it("closes shells that meet each other and the grid's ambiguous cells (two spheres, a saddle)", () => {
    const two = field(10, 0.5, (x, y, z) => Math.max(3 - Math.hypot(x - 3.2, y, z), 3 - Math.hypot(x + 3.2, y, z)));
    // Every cell ambiguous inside a border of nothing.
    const checker = field(5, 1, (x, y, z) => (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < 5 && (((x + y + z) % 2) + 2) % 2 === 0 ? 1 : -1));
    for (const g of [two, checker]) {
      const m = marchingCubes(g, 0);
      const edges = new Set<string>();
      for (let t = 0; t < m.indices.length; t += 3) for (const [x, y] of [[0, 1], [1, 2], [2, 0]] as const) edges.add(`${m.indices[t + x]}>${m.indices[t + y]}`);
      for (const k of edges) expect(edges.has(k.split(">").reverse().join(">"))).toBe(true);
      expect(m.indices.length).toBeGreaterThan(0);
    }
  });

  it("builds inbound shells from the negative side, and nothing where nothing crosses", () => {
    const low = field(10, 0.5, (x, y, z) => Math.hypot(x, y, z) - 6);
    const m = marchingCubes(low, 0, -1);
    expect(m.positions.length).toBeGreaterThan(0);
    expect(m.normals[0]! * m.positions[0]! + m.normals[1]! * m.positions[1]! + m.normals[2]! * m.positions[2]!).toBeGreaterThan(0);
    expect(marchingCubes(sphere, 100).indices.length).toBe(0);
    expect(marchingCubes(sphere, 100).top).toBeNull();
  });
});

describe("resample", () => {
  it("puts a tilt at its 4/3-earth beam height, half a beam deep", () => {
    // Echo everywhere on one 0.5° tilt; the column over a spot 100 km out.
    const s = sweep(0.5, () => 40, { nGates: 200 });
    const g = resample([s], { focus: east(100), half: 2, step: 1, dz: 0.02, top: 5, missing: 0, clamp: true });
    const mid = (g.nx - 1) / 2;
    const column = Array.from({ length: g.nz }, (_, k) => g.values[(k * g.ny + mid) * g.nx + mid]!);
    const lit = column.map((v, k) => (v > 0 ? g.z0 + k * g.dz : NaN)).filter((z) => !Number.isNaN(z));
    const beam = beamPosition(slantRange(100, 0.5), 0.5).height + 0.37;
    // 0.37 km antenna + 0.87 km of tilt + 0.59 km of earth curve (4/3 radius).
    expect(beam).toBeCloseTo(0.37 + 100 * Math.tan((0.5 * Math.PI) / 180) + 100 ** 2 / (2 * (4 / 3) * 6371.0088), 1);
    expect((Math.min(...lit) + Math.max(...lit)) / 2).toBeCloseTo(beam, 1);
    expect(Math.max(...lit) - Math.min(...lit)).toBeCloseTo((slantRange(100, 0.5) * BEAM_DEG * Math.PI) / 180, 0);
    expect(column.filter((v) => v > 0).every((v) => v === 40)).toBe(true);
  });

  it("blends between tilts by height, lands echo where the radar saw it, and keeps the outer nodes empty", () => {
    // 40 dBZ at 0.5°, 60 at 1.5°, both 50–60 km east only.
    const band = (dbz: number) => (az: number, km: number) => (az > 80 && az < 100 && km >= 45 && km <= 65 ? dbz : null);
    const sweeps = [sweep(0.5, band(40)), sweep(1.5, band(60))];
    const g = resample(sweeps, { focus: east(55), half: 15, step: 1, dz: 0.01, top: 4, missing: 0, clamp: true });
    const mid = (g.nx - 1) / 2;
    const at = (i: number, j: number, z: number) => g.values[(Math.round((z - g.z0) / g.dz) * g.ny + j) * g.nx + i]!;
    const h0 = beamPosition(slantRange(55, 0.5), 0.5).height + 0.37;
    const h1 = beamPosition(slantRange(55, 1.5), 1.5).height + 0.37;
    expect(at(mid, mid, (h0 + h1) / 2)).toBeCloseTo(50, 0);
    expect(at(mid, mid, h0 + (h1 - h0) / 4)).toBeCloseTo(45, 0);
    // 12 km north of the spot is outside the band.
    expect(at(mid, mid + 12, (h0 + h1) / 2)).toBe(0);
    for (const k of [0, g.nz - 1]) expect(g.values.subarray(k * g.nx * g.ny, (k + 1) * g.nx * g.ny).every((v) => v === 0)).toBe(true);
    expect(gridTop(g, 55)).toBeGreaterThan((h0 + h1) / 2);
    // No higher than the far edge of the band's top beam.
    expect(gridTop(g, 55)).toBeLessThanOrEqual(beamPosition(65, 1.5).height + 0.37 + (65 * BEAM_DEG * Math.PI) / 360 + 0.02);
    expect(gridTop(g, 65)).toBeNull();
  });

  it("sizes the box to the view, up to its limit", () => {
    expect(surfaceBox(30)).toMatchObject({ half: 30, step: 0.5 });
    expect(surfaceBox(60)).toMatchObject({ half: MAX_BOX_KM / 2, step: 1 });
    expect(surfaceBox(100).half).toBe(MAX_BOX_KM / 2);
  });
});

describe("shell colours", () => {
  it("take the palette's colour at the threshold", () => {
    const ref = DECODED_SCALES.ref;
    for (const dbz of [20, 30, 50, 60, 70]) expect(shellColor(ref, dbz).map((c) => Math.round(c * 255))).toEqual(scaleColor(ref, dbz));
    expect(shellColor(ref, 30)).not.toEqual(shellColor(ref, 60));
    for (const c of shellColor(ref, 50)) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    // Below the palette (clear there): grey rather than nothing.
    expect(shellColor(ref, -40)).toEqual([160 / 255, 160 / 255, 160 / 255]);
    expect(INBOUND[1]).toBeGreaterThan(INBOUND[0]);
    expect(OUTBOUND[0]).toBeGreaterThan(OUTBOUND[1]);
  });
});

describe("buildSurfaces", () => {
  /** A VCP 212-like volume (14 tilts, 0.5° radials, 250 m gates to 230 km) with a storm 60 km east: a 3D blob 70 dBZ at its heart, a rotating couplet in velocity. */
  const ANGLES = [0.5, 0.9, 1.3, 1.8, 2.4, 3.1, 4.0, 5.1, 6.4, 8.0, 10.0, 12.5, 15.6, 19.5];
  const C = { x: 60, y: 0, z: 6 };
  const local = (az: number, slant: number, elev: number) => {
    const b = beamPosition(slant, elev);
    const a = (az * Math.PI) / 180;
    return { x: b.ground * Math.sin(a), y: b.ground * Math.cos(a), z: b.height + 0.37 };
  };
  const dbz = (az: number, km: number, elev: number) => {
    if (az < 60 || az > 120 || km < 30 || km > 95) return null;
    const p = local(az, km, elev);
    const d = Math.hypot((p.x - C.x) / 14, (p.y - C.y) / 14, (p.z - C.z) / 7);
    return d < 1.4 ? 70 - 45 * d * d : null;
  };
  const kt = (az: number, km: number, elev: number) => {
    if (az < 75 || az > 105 || km < 45 || km > 75) return null;
    const p = local(az, km, elev);
    const d = Math.hypot(p.x - C.x, p.y - C.y);
    // ±30 m/s either side of the circulation, along the beam.
    return d < 8 && p.z < 9 ? (p.y > 0 ? -60 : 60) * Math.exp(-((d - 2) ** 2) / 8) : null;
  };
  const make = (f: typeof dbz, offset: number) => ANGLES.map((e) => sweep(e, (az, km) => f(az, km, e), { nRadials: 720, nGates: 920, gateKm: 0.25, offset }));
  const ref = make(dbz, 66);
  const vel = make(kt, 129);

  it("builds nested shells and a couplet for a storm-sized box in well under a second", () => {
    const req = { focus: east(60), radiusKm: 30, levels: [30, 50, 60], velocityMs: 20 };
    buildSurfaces(ref, vel, req);
    const t0 = performance.now();
    const s = buildSurfaces(ref, vel, req);
    const ms = performance.now() - t0;
    console.info(`[isosurface] 60 × 60 km × 18 km box at 0.5 km, 3 shells + velocity: ${ms.toFixed(0)} ms, ${s.ref.map((m) => m.indices.length / 3).join(" / ")} triangles`);
    expect(ms).toBeLessThan(1000);
    const [s30, s50, s60] = s.ref;
    expect(s30!.indices.length).toBeGreaterThan(s50!.indices.length);
    expect(s50!.indices.length).toBeGreaterThan(s60!.indices.length);
    expect(s60!.indices.length).toBeGreaterThan(0);
    // The 50 dBZ shell is 2/3 of the blob's size: its top about 6 + 7 × √(20/45) km.
    expect(s.top50).toBeCloseTo(C.z + 7 * Math.sqrt(20 / 45), 0);
    expect(s50!.top).toBeCloseTo(s.top50!, 0);
    expect(s.vel!.inbound.indices.length).toBeGreaterThan(0);
    expect(s.vel!.outbound.indices.length).toBeGreaterThan(0);
    // Inbound to the north of the centre, outbound south.
    const meanY = (m: { positions: Float32Array }) => m.positions.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) / (m.positions.length / 3);
    expect(meanY(s.vel!.inbound)).toBeGreaterThan(0);
    expect(meanY(s.vel!.outbound)).toBeLessThan(0);
  });

  it("does a 120 km box at 1 km in well under a second too", () => {
    const t0 = performance.now();
    const s = buildSurfaces(ref, null, { focus: east(60), radiusKm: 100, levels: [30, 50], velocityMs: null });
    const ms = performance.now() - t0;
    console.info(`[isosurface] 120 × 120 km × 18 km box at 1 km, 2 shells: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
    expect(s.box.half).toBe(60);
    expect(s.vel).toBeNull();
    expect(s.ref[0]!.indices.length).toBeGreaterThan(0);
  });
});
