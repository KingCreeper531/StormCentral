import { describe, expect, it } from "vitest";
import { noaaFrames, noaaLayerFor, noaaTileUrl, parseTimeDimension } from "./noaa";

describe("NOAA radar", () => {
  it("picks MRMS for the mosaic and super-res layers for NEXRAD sites", () => {
    expect(noaaLayerFor(null, "N0Q")?.layer).toBe("conus_bref_qcd");
    expect(noaaLayerFor("KTLX", "N0B")).toMatchObject({ workspace: "ktlx", layer: "ktlx_sr_bref" });
    expect(noaaLayerFor("KTLX", "N0G")?.layer).toBe("ktlx_sr_bvel");
    expect(noaaLayerFor("KTLX", "N0S")).toBeNull(); // storm-relative: IEM
    expect(noaaLayerFor("KTLX", "N1B")).toBeNull(); // higher tilt: IEM
    expect(noaaLayerFor("TOKC", "N0B")).toBeNull(); // TDWR: IEM
  });

  it("builds WMS tile templates", () => {
    const url = noaaTileUrl({ workspace: "conus", layer: "conus_bref_qcd" }, "2026-10-12T15:02:00.000Z");
    expect(url).toContain("/conus/ows?");
    expect(url).toContain("layers=conus_bref_qcd");
    expect(url).toContain("bbox={bbox-epsg-3857}");
    expect(url).toContain("time=2026-10-12T15%3A02%3A00.000Z");
  });

  it("parses list and interval time dimensions", () => {
    const list = `<Layer><Dimension name="time" default="current" units="ISO8601">2026-10-12T15:00:00.000Z,2026-10-12T15:02:00.000Z,2026-10-12T15:04:00.000Z</Dimension></Layer>`;
    expect(parseTimeDimension(list)).toEqual(["2026-10-12T15:00:00.000Z", "2026-10-12T15:02:00.000Z", "2026-10-12T15:04:00.000Z"]);
    const interval = `<Dimension name="time" units="ISO8601">2026-10-12T14:00:00Z/2026-10-12T15:00:00Z/PT10M</Dimension>`;
    expect(parseTimeDimension(interval)).toHaveLength(7);
    expect(parseTimeDimension("<nothing/>")).toEqual([]);
  });

  it("spreads frames over the span, ending on the newest", () => {
    const times = Array.from({ length: 60 }, (_, i) => new Date(Date.parse("2026-10-12T13:00:00Z") + i * 120_000).toISOString());
    const frames = noaaFrames(noaaLayerFor(null, "N0Q")!, times, 12, 60 * 60_000);
    expect(frames).toHaveLength(12);
    expect(frames.at(-1)!.time).toBe(Date.parse(times.at(-1)!));
    expect(frames[0]!.time).toBeGreaterThanOrEqual(Date.parse(times.at(-1)!) - 60 * 60_000);
  });
});
