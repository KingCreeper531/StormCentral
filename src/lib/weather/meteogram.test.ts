import { describe, expect, it } from "vitest";
import { accumulate, COMPARE_MODELS, ensembleUrl, hasData, multiModelUrl, parseEnsemble, parseMultiModel, plumeStats, startIndex } from "./meteogram";

const T0 = 1_792_540_800; // 2026-10-20 00 UTC, seconds

describe("multi-model answers", () => {
  it("read each model's suffixed series, and nulls for what a model leaves out", () => {
    const d = parseMultiModel(
      {
        hourly: {
          time: [T0, T0 + 3600],
          temperature_2m_ecmwf_ifs025: [20.5, 21],
          temperature_2m_gfs_seamless: [19, null],
          cape_ecmwf_ifs025: [1200, 1500],
          cape_gfs_seamless: [null, null],
        },
      },
      ["ecmwf_ifs025", "gfs_seamless"],
    );
    expect(d.time).toEqual([T0 * 1000, (T0 + 3600) * 1000]);
    expect(d.values.temp.ecmwf_ifs025).toEqual([20.5, 21]);
    expect(d.values.temp.gfs_seamless).toEqual([19, null]);
    expect(hasData(d.values.cape.gfs_seamless)).toBe(false);
    // Asked for but not in the answer at all.
    expect(d.values.gust.ecmwf_ifs025).toEqual([null, null]);
  });

  it("read unsuffixed keys when only one model was asked for", () => {
    const d = parseMultiModel({ hourly: { time: [T0], temperature_2m: [10] } }, ["gfs_seamless"]);
    expect(d.values.temp.gfs_seamless).toEqual([10]);
  });

  it("ask for every variable, the last 12 hours and SI units", () => {
    const u = new URL(multiModelUrl({ lat: 35.22261, lon: -97.43951 }, ["ecmwf_ifs025", "gfs_seamless"]));
    expect(u.searchParams.get("models")).toBe("ecmwf_ifs025,gfs_seamless");
    expect(u.searchParams.get("hourly")).toBe("temperature_2m,dew_point_2m,precipitation,wind_gusts_10m,cape,pressure_msl");
    expect(u.searchParams.get("latitude")).toBe("35.223");
    expect(u.searchParams.get("past_hours")).toBe("12");
    expect(u.searchParams.get("forecast_hours")).toBe("360");
    expect(u.searchParams.get("wind_speed_unit")).toBe("ms");
    expect(new URL(ensembleUrl({ lat: 35, lon: -97 }, "ncep_gefs025", "gust")).searchParams.get("hourly")).toBe("wind_gusts_10m");
  });

  it("offer at most eight models, one colour each", () => {
    expect(COMPARE_MODELS.length).toBeLessThanOrEqual(8);
    expect(new Set(COMPARE_MODELS.map((m) => m.id)).size).toBe(COMPARE_MODELS.length);
  });
});

describe("ensembles", () => {
  it("put the control run first, then members in number order, and drop empty ones", () => {
    const run = parseEnsemble(
      {
        hourly: {
          time: [T0],
          temperature_2m_member10: [3],
          temperature_2m_member02: [2],
          temperature_2m: [1],
          temperature_2m_member03: [null],
          dew_point_2m: [0],
        },
      },
      "temp",
    );
    expect(run.members).toEqual([[1], [2], [3]]);
  });

  it("summarise the spread", () => {
    const members = [
      [0, 10],
      [1, null],
      [2, 30],
      [3, 40],
      [4, 50],
    ];
    const s = plumeStats(members);
    expect(s.mean[0]).toBe(2);
    expect(s.min[0]).toBe(0);
    expect(s.max[0]).toBe(4);
    expect(s.p10[0]).toBeCloseTo(0.4);
    expect(s.p90[0]).toBeCloseTo(3.6);
    expect(s.mean[1]).toBe(32.5);
    // Fewer than half the members: no summary.
    expect(plumeStats([[1], [null], [null]]).mean[0]).toBeNull();
  });
});

describe("rain totals", () => {
  it("add up from now on, holding over gaps", () => {
    expect(accumulate([5, 1, 2, null, 0.5, -0.1], 1)).toEqual([null, 1, 3, 3, 3.5, 3.5]);
    expect(accumulate([null, null], 0)).toEqual([null, null]);
  });

  it("start at the current hour", () => {
    const now = 1_000_000_000_000;
    expect(startIndex([now - 7_200_000, now - 3_600_000, now - 600_000, now + 3_000_000], now)).toBe(2);
    expect(startIndex([], now)).toBe(0);
  });
});
