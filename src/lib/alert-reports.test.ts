import { describe, expect, it } from "vitest";
import type { WeatherAlert } from "./api/types";
import type { StormReport } from "./feeds/storm-reports";
import { isSpotterSource, reportsInAlert } from "./alert-reports";

const alert = {
  id: "a",
  sent: "2026-10-12T20:00:00Z",
  effective: "2026-10-12T20:00:00Z",
  expires: "2026-10-12T21:00:00Z",
  ends: "2026-10-12T21:00:00Z",
  geometry: { type: "Polygon", coordinates: [[[-98, 35], [-97, 35], [-97, 36], [-98, 36], [-98, 35]]] },
} as unknown as WeatherAlert;

const report = (o: Partial<StormReport>): StormReport =>
  ({ id: Math.random().toString(36), time: "2026-10-12T20:20:00Z", kind: "hail", typeText: "HAIL", magnitude: 1.75, unit: "INCH", measured: null, place: "Norman", county: null, state: "OK", source: "TRAINED SPOTTER", remark: null, wfo: "OUN", lat: 35.5, lon: -97.5, ...o }) as StormReport;

describe("reportsInAlert", () => {
  it("keeps reports inside the polygon while the warning is in effect", () => {
    const r = reportsInAlert(
      alert,
      [
        report({}),
        report({ kind: "wind", typeText: "TSTM WND GST", magnitude: 70, unit: "MPH", source: "PUBLIC" }),
        report({ kind: "tornado", typeText: "TORNADO", magnitude: null, unit: null, source: "STORM CHASER" }),
        report({ lat: 34 }), // outside
        report({ time: "2026-10-12T18:00:00Z" }), // long before
      ],
      Date.parse("2026-10-12T20:40:00Z"),
    );
    expect(r.reports).toHaveLength(3);
    expect(r).toMatchObject({ spotters: 2, maxHailIn: 1.75, maxWindMph: 70, tornadoes: 1 });
  });

  it("recognises spotter sources", () => {
    expect(isSpotterSource("TRAINED SPOTTER")).toBe(true);
    expect(isSpotterSource("EMERGENCY MNGR")).toBe(true);
    expect(isSpotterSource("PUBLIC")).toBe(false);
    expect(isSpotterSource(null)).toBe(false);
  });
});
