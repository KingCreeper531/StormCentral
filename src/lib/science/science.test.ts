import { describe, expect, it } from "vitest";
import { bestOutdoorWindow, pm25ToAqi, pollenLevel, usAqiCategory } from "./air";
import { dewPoint, estimateCeiling, lclHeightM } from "./atmosphere";
import { computeDop, invert4 } from "./dop";
import { classifyTendency, tendencyAt } from "./pressure";
import { biteIndex, DRONE_PROFILES, droneFlyability, type DroneConditions } from "./scores";
import { angleDiff, bulkShear, fromUV, toUV, windAtHeight } from "./wind";

describe("wind", () => {
  it("round-trips u/v", () => {
    const { u, v } = toUV(10, 270);
    expect(u).toBeCloseTo(10); // westerly wind blows toward +x
    const back = fromUV(u, v);
    expect(back.speedMs).toBeCloseTo(10);
    expect(back.dirDeg).toBeCloseTo(270);
  });

  it("computes bulk shear and veering", () => {
    const s = bulkShear({ heightM: 10, speedMs: 4, dirDeg: 180 }, { heightM: 120, speedMs: 12, dirDeg: 225 });
    expect(s.deltaMs).toBeGreaterThan(8);
    expect(s.veerDeg).toBe(45);
    expect(s.classification).toBe("strong");
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });

  it("log-interpolates between levels", () => {
    const profile = [
      { heightM: 10, speedMs: 5, dirDeg: 200 },
      { heightM: 80, speedMs: 9, dirDeg: 210 },
      { heightM: 120, speedMs: 10, dirDeg: 215 },
    ];
    const w = windAtHeight(profile, 40)!;
    expect(w.speedMs).toBeGreaterThan(5);
    expect(w.speedMs).toBeLessThan(9);
    expect(windAtHeight(profile, 2)!.speedMs).toBeLessThan(5);
    expect(windAtHeight(profile, 500)!.speedMs).toBe(10);
  });
});

describe("atmosphere", () => {
  it("computes dew point and LCL", () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.3, 1);
    expect(lclHeightM(25, 15)).toBe(1250);
  });

  it("estimates ceilings by layer", () => {
    expect(estimateCeiling({ tempC: 20, dewPointC: 18, lowPct: 80, midPct: 0, highPct: 0 })).toMatchObject({ layer: "low", baseM: 250 });
    expect(estimateCeiling({ tempC: 20, dewPointC: 5, lowPct: 10, midPct: 10, highPct: 10 }).baseM).toBeNull();
  });
});

describe("pressure", () => {
  it("uses Met Office tendency terms", () => {
    expect(classifyTendency(0.05).term).toBe("steady");
    expect(classifyTendency(-1).term).toBe("falling slowly");
    expect(classifyTendency(2.5).term).toBe("rising");
    expect(classifyTendency(-4).term).toBe("falling quickly");
    expect(classifyTendency(7).term).toBe("rising very rapidly");
    expect(tendencyAt([1010, null, 1011, 1011], 3)?.term).toBe("rising slowly");
    expect(tendencyAt([null, 1, 1, 1], 3)).toBeNull();
  });
});

describe("dop", () => {
  it("inverts matrices", () => {
    const I = invert4([[2, 0, 0, 0], [0, 4, 0, 0], [0, 0, 5, 0], [0, 0, 0, 10]])!;
    expect(I[1]![1]).toBeCloseTo(0.25);
    expect(invert4([[1, 1, 1, 1], [1, 1, 1, 1], [0, 0, 1, 0], [0, 0, 0, 1]])).toBeNull();
  });

  it("rewards well-spread geometry", () => {
    const r = Math.PI / 180;
    const good = [0, 90, 180, 270].map((az) => ({ azimuth: az * r, elevation: 15 * r })).concat({ azimuth: 0, elevation: 89 * r });
    const bad = [0, 10, 20, 30, 40].map((az) => ({ azimuth: az * r, elevation: (40 + az / 2) * r }));
    const g = computeDop(good)!;
    const b = computeDop(bad);
    expect(g.pdop).toBeLessThan(3);
    expect(b === null || b.pdop > g.pdop * 3).toBe(true);
    expect(computeDop(good.slice(0, 3))).toBeNull();
  });
});

describe("air", () => {
  it("maps PM2.5 to the 2024 EPA AQI", () => {
    expect(pm25ToAqi(9.0)).toBe(50);
    expect(pm25ToAqi(35.4)).toBe(100);
    expect(pm25ToAqi(12)).toBe(56);
    expect(pm25ToAqi(1000)).toBe(500);
  });

  it("categorises AQI and pollen", () => {
    expect(usAqiCategory(42)?.label).toBe("Good");
    expect(usAqiCategory(151)?.label).toBe("Unhealthy");
    expect(usAqiCategory(null)).toBeNull();
    expect(pollenLevel("grass", 25)).toBe("high");
    expect(pollenLevel("birch", 10)).toBe("low");
    expect(pollenLevel("ragweed", 600)).toBe("very high");
  });

  it("finds the cleanest outdoor window", () => {
    const times = Array.from({ length: 12 }, (_, i) => i * 3600);
    const aqi = [80, 70, 30, 25, 60, 90, 100, 100, 40, 40, 40, 40];
    expect(bestOutdoorWindow(times, aqi, 0, 2)).toMatchObject({ start: 7200, meanAqi: 27.5 });
  });
});

describe("scores", () => {
  const calm: DroneConditions = {
    windAtAltitudeMs: 3,
    gustMs: 4,
    precipProbPct: 0,
    precipMm: 0,
    visibilityM: 20000,
    ceilingM: null,
    flightAltitudeM: 120,
    tempC: 18,
    kp: 2,
    skyPhase: "day",
  };
  const mini = DRONE_PROFILES[0]!;

  it("clears calm conditions", () => {
    const r = droneFlyability(calm, mini);
    expect(r.status).toBe("go");
    expect(r.score).toBe(100);
  });

  it("grounds a mini in a gale and explains why", () => {
    const r = droneFlyability({ ...calm, windAtAltitudeMs: 14, gustMs: 18, kp: 7 }, mini);
    expect(r.status).toBe("no-go");
    expect(r.factors.filter((f) => f.status === "no-go").map((f) => f.key)).toEqual(["wind", "gust", "kp"]);
  });

  it("enforces Part 107 cloud clearance", () => {
    const r = droneFlyability({ ...calm, ceilingM: 200 }, mini);
    expect(r.factors.find((f) => f.key === "ceiling")?.status).toBe("no-go");
  });

  it("rates a dawn major period before a front as excellent", () => {
    const r = biteIndex({
      tendency: classifyTendency(-1.2),
      inMajorPeriod: true,
      inMinorPeriod: false,
      solunarDayRating: 4,
      hoursFromSunEvent: 0.5,
      cloudPct: 40,
      windMs: 3,
      waterTempC: 16,
      weatherCode: 2,
      flowChange24h: 0.02,
    });
    expect(r.label).toBe("Excellent");
    expect(r.safety).toBeNull();
  });

  it("flags lightning", () => {
    const r = biteIndex({
      tendency: null,
      inMajorPeriod: false,
      inMinorPeriod: false,
      solunarDayRating: 1,
      hoursFromSunEvent: 5,
      cloudPct: 100,
      windMs: 12,
      waterTempC: null,
      weatherCode: 95,
      flowChange24h: null,
    });
    expect(r.label).toBe("Poor");
    expect(r.safety).toMatch(/Lightning/);
  });
});
