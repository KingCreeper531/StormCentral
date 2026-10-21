import { describe, expect, it } from "vitest";
import type { Forecast } from "../api/open-meteo";
import { DRONE_PROFILES } from "../science/scores";
import { flyabilityAt } from "./hourly-scores";

/** One early-afternoon hour in Norman, OK, from a model with 10 m wind only. */
function hour(values: Record<string, number | null>): Forecast {
  const hourly: Record<string, (number | null)[]> = { time: [Date.parse("2026-06-21T18:00:00Z") / 1000] };
  const all = { wind10: 4, dir10: 180, wind80: null, dir80: null, wind120: null, dir120: null, wind180: null, dir180: null, gust10: 5, precipProb: 0, precip: 0, temp: 22, dewPoint: 8, cloudLow: 0, cloudMid: 0, cloudHigh: 0, visibility: 20000, ...values };
  for (const [k, v] of Object.entries(all)) hourly[k] = [v];
  return { hourly } as unknown as Forecast;
}

const opts = { altitudeM: 120, profile: DRONE_PROFILES[0]!, lat: 35.22, lon: -97.44 };

describe("flyabilityAt", () => {
  it("extrapolates 10 m wind up to flight altitude", () => {
    const r = flyabilityAt(hour({}), 0, opts);
    expect(r.atAlt!.speedMs).toBeCloseTo(4 * 12 ** (1 / 7));
    expect(r.gustAtAlt).toBeCloseTo(5 * 12 ** (1 / 7));
    expect(r.result.status).toBe("go");
  });

  it("doesn't call missing gusts or rain chances calm", () => {
    const r = flyabilityAt(hour({ gust10: null, precipProb: null }), 0, opts);
    expect(r.gustAtAlt).toBeNull();
    expect(r.result.status).toBe("caution");
    expect(r.result.factors.filter((f) => f.status === "caution").map((f) => f.key)).toEqual(["gust", "precip"]);
  });
});
