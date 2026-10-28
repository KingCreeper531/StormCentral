import { describe, expect, it } from "vitest";
import { slantRange, type Sweep } from "./nexrad/sweep";
import { DECODED_SCALES } from "./scales";
import type { Sounding } from "./thermo";
import { beamPosition, formatHeight, freezingLevels, groundLines, heightTicks, MAX_FILL_KM, topOf, volumePoints } from "./volume3d";

const RADAR = { lat: 35.333, lon: -97.278 };

/**
 * A made-up sweep: 1° radials and 1 km gates, raw level = 2 × dBZ + 66 (as
 * Level II), with `echo(az, km)` giving each gate's dBZ (null: none).
 */
function sweep(elevation: number, echo: (az: number, km: number) => number | null): Sweep {
  const nRadials = 360;
  const nGates = 120;
  const data = new Uint8Array(nRadials * nGates);
  for (let r = 0; r < nRadials; r++)
    for (let g = 0; g < nGates; g++) {
      const v = echo(r + 0.5, 0.5 + g);
      if (v != null) data[r * nGates + g] = Math.round(v * 2 + 66);
    }
  const table = new Float32Array(256).fill(NaN);
  for (let i = 2; i < 256; i++) table[i] = (i - 66) / 2;
  return {
    ...RADAR,
    heightM: 370,
    time: 0,
    elevation,
    nRadials,
    nGates,
    firstGateKm: 0.5,
    gateKm: 1,
    azStart: Float32Array.from({ length: nRadials }, (_, i) => i),
    azWidth: new Float32Array(nRadials).fill(1),
    data,
    table,
    special: [{ level: 1, label: "RF" }],
  };
}

/** A storm due east of the radar, 50–60 km out, on every tilt. */
const storm = (dbz: number) => (az: number, km: number) => (az > 85 && az < 95 && km >= 50 && km <= 60 ? dbz : null);
/** About 55 km east of the radar. */
const SPOT = { lat: RADAR.lat, lon: RADAR.lon + 55 / (111.32 * Math.cos((RADAR.lat * Math.PI) / 180)) };
const options = { focus: SPOT, radiusKm: 20, threshold: 20, scale: DECODED_SCALES.ref };

describe("beam geometry", () => {
  it("puts the beam where the 4/3-earth model says, and agrees with the ground → slant conversion", () => {
    const p = beamPosition(100, 0.5);
    expect(p.height).toBeCloseTo(100 * Math.sin((0.5 * Math.PI) / 180) + 100 ** 2 / (2 * (4 / 3) * 6371.0088), 2);
    for (const [ground, elev] of [[30, 0.5], [80, 3.1], [150, 1.3]] as const) expect(beamPosition(slantRange(ground, elev), elev).ground).toBeCloseTo(ground, 3);
  });
});

describe("volumePoints", () => {
  const low = sweep(0.5, storm(40));
  const high = sweep(1.5, storm(50));

  it("places each gate at its height above sea level, around the spot", () => {
    const p = volumePoints([low], options);
    expect(p.count).toBeGreaterThan(50);
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = [p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!];
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(20);
      // 50–60 km out at 0.5°: about 0.6–0.7 km above the antenna.
      expect(z).toBeGreaterThan(0.37 + 0.55);
      expect(z).toBeLessThan(0.37 + 0.8);
      expect(p.values[i]).toBe(40);
    }
    // The radar is 55 km west of the spot, at its antenna height.
    expect(p.radar.x).toBeCloseTo(-55, 0);
    expect(p.radar.z).toBeCloseTo(0.37);
    expect([...p.colors.slice(0, 3)]).not.toEqual([0, 0, 0]);
  });

  it("leaves out gates under the threshold and outside the circle", () => {
    expect(volumePoints([low], { ...options, threshold: 45 }).count).toBe(0);
    expect(volumePoints([low], { ...options, focus: { lat: RADAR.lat + 1, lon: RADAR.lon } }).count).toBe(0);
  });

  it("fills between tilts that both have echo, blending their values, and only when asked", () => {
    const plain = volumePoints([low, high], options);
    const filled = volumePoints([low, high], { ...options, fill: true });
    expect(filled.count).toBeGreaterThan(plain.count);
    const between = Array.from(filled.values.subarray(0, filled.count)).filter((v) => v > 40 && v < 50);
    expect(between.length).toBeGreaterThan(0);
    // Nothing to fill towards where the tilt above has no echo.
    const empty = sweep(1.5, () => null);
    expect(volumePoints([low, empty], { ...options, fill: true }).count).toBe(volumePoints([low], options).count);
    // Tilts too far apart stay apart.
    const far = sweep(9, storm(50));
    expect(volumePoints([low, far], { ...options, fill: true }).count).toBe(volumePoints([low, far], options).count);
    expect(beamPosition(55, 9).height - beamPosition(55, 0.5).height).toBeGreaterThan(MAX_FILL_KM);
  });

  it("thins evenly past the point budget", () => {
    const all = volumePoints([low], options);
    const thin = volumePoints([low], { ...options, maxPoints: Math.floor(all.count / 3) });
    expect(thin.stride).toBeGreaterThan(1);
    expect(thin.count).toBeLessThanOrEqual(Math.floor(all.count / 3));
    expect(thin.count).toBeGreaterThan(0);
  });

  it("finds the top of the echo and of a core", () => {
    const p = volumePoints([low, high], options);
    const top = topOf(p, 20)!;
    expect(top).toBeCloseTo(Math.max(...Array.from(p.positions.filter((_, i) => i % 3 === 2).subarray(0, p.count))), 5);
    expect(topOf(p, 45)).toBeGreaterThan(topOf(volumePoints([low], options), 20)!);
    expect(topOf(p, 60)).toBeNull();
  });
});

describe("groundLines", () => {
  it("puts map lines in the spot's frame, clipped to the square", () => {
    // A line due east–west through the spot, past the square both ways (27 km), and one nowhere near.
    const across = [
      [SPOT.lon - 0.3, SPOT.lat],
      [SPOT.lon + 0.3, SPOT.lat],
    ];
    const away = [
      [SPOT.lon, SPOT.lat + 3],
      [SPOT.lon + 1, SPOT.lat + 3],
    ];
    const l = groundLines([across, away], RADAR, SPOT, 20, 0.37);
    expect(l.length).toBe(6);
    expect(l[0]).toBeCloseTo(-20, 3);
    expect(l[3]).toBeCloseTo(20, 3);
    // Along y = 0, give or take how a parallel curves in the radar's frame.
    expect(Math.abs(l[1]!)).toBeLessThan(0.2);
    expect(l[2]).toBeCloseTo(0.37);
    expect(groundLines([away], RADAR, SPOT, 20, 0).length).toBe(0);
  });
});

describe("freezingLevels", () => {
  const sounding = (temps: [number, number][]): Sounding => ({ sfcZ: temps[0]![0], levels: temps.map(([z, t]) => ({ p: 1000 - z / 10, z, t, td: t - 5, u: 0, v: 0 })) });

  it("finds where it first cools through 0 °C and −20 °C, interpolating between levels", () => {
    const l = freezingLevels(sounding([[300, 25], [3000, 5], [5000, -5], [8000, -25]]));
    expect(l.zero).toBeCloseTo(4.0, 3);
    expect(l.minus20).toBeCloseTo(7.25, 3);
  });

  it("says when the ground is already below freezing, and when the profile never gets there", () => {
    expect(freezingLevels(sounding([[300, -3], [3000, -15]])).zero).toBeCloseTo(0.3);
    expect(freezingLevels(sounding([[300, 30], [3000, 10]]))).toEqual({ zero: null, minus20: null });
    expect(freezingLevels(null)).toEqual({ zero: null, minus20: null });
  });
});

describe("height scale", () => {
  it("ticks every 10 kft (5 for short ones) or 2 km (1 for short ones)", () => {
    expect(heightTicks(15, true).map((t) => t.label)).toEqual(["0", "10", "20", "30", "40"]);
    expect(heightTicks(5, true).map((t) => t.label)).toEqual(["0", "5", "10", "15"]);
    expect(heightTicks(9, false).map((t) => t.label)).toEqual(["0", "2", "4", "6", "8"]);
    expect(heightTicks(4, false).map((t) => t.label)).toEqual(["0", "1", "2", "3", "4"]);
    expect(heightTicks(15, true)[1]!.km).toBeCloseTo(3.048);
  });

  it("formats heights", () => {
    expect(formatHeight(10, true)).toBe("32.8 kft");
    expect(formatHeight(10, false)).toBe("10.0 km");
  });
});
