import { describe, expect, it } from "vitest";
import { parseModelGrid, WindSampler, type GridPlan } from "./grid";
import { particleBudget, Particles, TRAIL, type ParticleView } from "./particles";

const PLAN: GridPlan = { bbox: { west: -10, east: 10, south: -10, north: 10 }, cols: 2, rows: 2, step: 10 };
const westerly = (speed: number) => ({ hourly: { time: [0], wind_speed_10m: [speed], wind_direction_10m: [270] } });
const sampler = (speed: number) => new WindSampler(parseModelGrid([westerly(speed), westerly(speed), westerly(speed), westerly(speed)], PLAN), 0);

/** A flat 1000 px map, 50 px per degree, centred on 0°, 0°. */
const view = (spawnAt: [number, number] = [0, 0]): ParticleView => ({
  width: 1000,
  height: 1000,
  pxPerDeg: 50,
  project: (lon, y, out) => {
    out[0] = 500 + lon * 50;
    out[1] = 500 - ((y * 180) / Math.PI) * 50;
  },
  spawn: (out) => {
    out[0] = spawnAt[0];
    out[1] = spawnAt[1];
  },
});

describe("wind particles", () => {
  it("drift downwind and keep a trail in screen pixels", () => {
    const p = new Particles(1, () => 0.5);
    const v = view();
    p.reset(v);
    const wind = sampler(10);
    for (let i = 0; i < 5; i++) p.step(wind, v);
    expect(p.lon[0]).toBeGreaterThan(0);
    expect(Math.abs(p.y[0]!)).toBeLessThan(1e-9);
    expect(p.len[0]).toBe(6);
    const newest = p.point(0, 0);
    const oldest = p.point(0, 5);
    expect(p.trail[newest]).toBeGreaterThan(p.trail[oldest]!);
    expect(p.trail[newest + 1]).toBeCloseTo(500);
  });

  it("move faster in stronger wind, up to a cap", () => {
    const moved = (speed: number) => {
      const p = new Particles(1, () => 0.5);
      const v = view();
      p.reset(v);
      p.step(sampler(speed), v);
      return p.lon[0]! * 50; // px
    };
    expect(moved(20)).toBeCloseTo(2 * moved(10));
    expect(moved(200)).toBeLessThanOrEqual(3.5 + 1e-9);
  });

  it("start over outside the grid, and cap the trail length", () => {
    const p = new Particles(1, () => 0.5);
    const v = view([30, 0]); // spawns outside the grid
    p.reset(v);
    for (let i = 0; i < 3; i++) p.step(sampler(10), v);
    expect(p.len[0]).toBe(1);
    const q = new Particles(1, () => 0);
    const w = view();
    q.reset(w);
    for (let i = 0; i < TRAIL * 2; i++) q.step(sampler(1), w);
    expect(q.len[0]).toBe(TRAIL);
  });

  it("scale the count to the map and the cap", () => {
    expect(particleBudget(1920, 1080, 3000)).toBe(3000);
    expect(particleBudget(390, 700, 900)).toBe(853);
    expect(particleBudget(0, 700, 900)).toBe(0);
  });
});
