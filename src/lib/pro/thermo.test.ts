import { describe, expect, it } from "vitest";
import {
  analyze,
  bunkers,
  dewpointFromMixingRatio,
  helicity,
  lcl,
  liftParcel,
  mixingRatio,
  moistAdiabat,
  precipitableWater,
  satVapPres,
  surfaceParcel,
  windComponents,
  windFrom,
  type Level,
  type Sounding,
} from "./thermo";

/**
 * A warm, moist, sheared spring sounding: 7.5 °C/km lapse rate above a 30/22 °C
 * surface at 1000 hPa up to an isothermal tropopause, drying aloft, winds
 * veering from SSE 10 m/s to W 30 m/s.
 */
function springSounding(): Sounding {
  const levels: Level[] = [];
  for (let p = 1000; p >= 150; p -= 25) {
    // Standard-ish heights from the hypsometric equation with a mean 260 K column.
    const z = 100 + 29.3 * 260 * Math.log(1000 / p);
    const agl = z - 100;
    // Tropopause near 11.5 km: isothermal above.
    const t = Math.max(-56, 30 - 7.5 * (agl / 1000));
    const td = agl < 1500 ? 22 - 2 * (agl / 1000) : Math.min(t - 10, 19 - 8 * ((agl - 1500) / 1000));
    const frac = Math.min(1, agl / 6000);
    const { u, v } = windComponents(10 + 20 * frac, 160 + 110 * frac);
    levels.push({ p, z, t, td, u, v });
  }
  return { levels, sfcZ: levels[0]!.z };
}

describe("thermodynamics", () => {
  it("vapour pressure, dew point and mixing ratio", () => {
    expect(satVapPres(0)).toBeCloseTo(6.112, 3);
    const w = mixingRatio(1000, 20);
    expect(w * 1000).toBeGreaterThan(14);
    expect(w * 1000).toBeLessThan(15.5);
    expect(dewpointFromMixingRatio(1000, w)).toBeCloseTo(20, 1);
  });

  it("finds the LCL about 125 m per degree of dew point depression", () => {
    const l = lcl(1000, 30, 20);
    expect(l.p).toBeGreaterThan(855);
    expect(l.p).toBeLessThan(880);
    expect(l.t).toBeGreaterThan(17);
    expect(l.t).toBeLessThan(19);
  });

  it("follows a moist adiabat", () => {
    const t500 = moistAdiabat(1000, 20, 500);
    expect(t500).toBeGreaterThan(-10);
    expect(t500).toBeLessThan(-2);
  });

  it("round-trips wind components", () => {
    const { u, v } = windComponents(10, 270);
    expect(u).toBeCloseTo(10, 5);
    expect(v).toBeCloseTo(0, 5);
    expect(windFrom(u, v).dir).toBeCloseTo(270, 5);
  });
});

describe("sounding analysis", () => {
  const s = springSounding();

  it("gives a strongly unstable surface parcel with an LFC and EL", () => {
    const r = liftParcel(s, surfaceParcel(s));
    expect(r.cape).toBeGreaterThan(1500);
    expect(r.cape).toBeLessThan(6000);
    expect(r.cin).toBeLessThanOrEqual(0);
    expect(r.lfcP).not.toBeNull();
    expect(r.elP).not.toBeNull();
    expect(r.elP!).toBeLessThan(r.lfcP!);
  });

  it("computes the rest of the indices in sensible ranges", () => {
    const a = analyze(s);
    expect(a.li!).toBeLessThan(-3);
    expect(a.pwat).toBeGreaterThan(25);
    expect(a.pwat).toBeLessThan(60);
    expect(a.lapse03!).toBeCloseTo(7.5, 0);
    expect(a.shear06! * 1.943844).toBeGreaterThan(30);
    expect(a.ml.cape).toBeLessThanOrEqual(a.mu.cape + 1);
    expect(a.srh03!).toBeGreaterThan(50);
    expect(a.criticalAngle).not.toBeNull();
  });

  it("puts the Bunkers right mover to the right of the mean wind, with positive SRH for a veering profile", () => {
    const b = bunkers(s)!;
    // Right of the shear vector: for westerly shear that's south of the mean wind.
    expect(b.rm.v).toBeLessThan(b.mean.v);
    expect(helicity(s, 1000, b.rm)!).toBeGreaterThan(0);
  });

  it("precipitable water is zero for a bone-dry column and grows with moisture", () => {
    const dry: Sounding = { ...s, levels: s.levels.map((l) => ({ ...l, td: -80 })) };
    expect(precipitableWater(dry)).toBeLessThan(0.5);
    expect(precipitableWater(s)).toBeGreaterThan(precipitableWater(dry));
  });
});

describe("stable profiles", () => {
  it("finds no LFC or CAPE when the only warmth is below the LCL (morning inversion)", () => {
    // Cool surface under a warm nose; a mixed-layer parcel starts warmer than the surface air but is stable aloft.
    const levels: Level[] = [];
    for (let p = 980; p >= 150; p -= 20) {
      const z = 300 + 29.3 * 260 * Math.log(980 / p);
      const agl = z - 300;
      const t = agl < 400 ? 8 + agl / 40 : Math.max(-56, 18 - 7 * ((agl - 400) / 1000));
      levels.push({ p, z, t, td: Math.min(t - 6, 2 - 3 * (agl / 1000)), u: 0, v: 0 });
    }
    const s: Sounding = { levels, sfcZ: levels[0]!.z };
    const a = analyze(s);
    expect(a.ml.lfcP).toBeNull();
    expect(a.ml.cape).toBe(0);
    expect(a.sb.cape).toBe(0);
  });
});
