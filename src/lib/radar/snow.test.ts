import { describe, expect, it } from "vitest";
import { isSnowMap, isSnowThreshold, NOHRSC_SNOW, parseSnowLegend, snowLegendUrl, snowSource, snowThresholdLabel, snowTileUrl, WPC_WINTER } from "./snow";

describe("snow maps", () => {
  it("picks WPC's layer for each day and threshold", () => {
    expect(snowSource("off")).toBeNull();
    expect(snowSource("day1", 4)).toMatchObject({ service: WPC_WINTER, layer: 1, attribution: "Snowfall: NWS / WPC" });
    expect(snowSource("day1", 8)?.layer).toBe(2);
    expect(snowSource("day2", 4)?.layer).toBe(6);
    expect(snowSource("day3", 4)?.layer).toBe(11);
    expect(snowSource("day3", 12)?.layer).toBe(13);
  });

  it("draws NOHRSC's depth image, whatever the threshold", () => {
    expect(snowSource("depth", 8)).toMatchObject({ service: NOHRSC_SNOW, layer: 3, attribution: "Snow depth: NWS / NOHRSC" });
  });

  it("asks the map service for one transparent Web Mercator tile per request, a new address per update", () => {
    const src = snowSource("day2", 8)!;
    const url = snowTileUrl(src, 5);
    expect(url.startsWith(`${WPC_WINTER}/export?`)).toBe(true);
    for (const part of ["bbox={bbox-epsg-3857}", "bboxSR=3857", "imageSR=3857", "size=256,256", "transparent=true", "layers=show:7", "f=image", "_=5"]) expect(url).toContain(part);
    expect(snowTileUrl(src, 6)).not.toBe(url);
    expect(snowLegendUrl(src)).toBe(`${WPC_WINTER}/legend?f=json`);
  });

  it("reads one layer's key out of the service's legend", () => {
    const json = {
      layers: [
        { layerId: 1, legend: [{ label: "10% - 40%", imageData: "iVBORw0KGgo=", contentType: "image/png" }] },
        {
          layerId: 3,
          legend: [
            { label: " High : 100 ", imageData: "AAAA", contentType: "image/png" },
            { label: "no picture" },
            { label: "bad", imageData: "<script>" },
            { imageData: "BBBB", contentType: "text/html" },
          ],
        },
      ],
    };
    expect(parseSnowLegend(json, 1)).toEqual([{ label: "10% - 40%", image: "data:image/png;base64,iVBORw0KGgo=" }]);
    expect(parseSnowLegend(json, 3)).toEqual([
      { label: "High : 100", image: "data:image/png;base64,AAAA" },
      { label: "", image: "data:image/png;base64,BBBB" },
    ]);
    expect(parseSnowLegend(json, 9)).toEqual([]);
    expect(parseSnowLegend(null, 1)).toEqual([]);
    expect(parseSnowLegend({ error: { code: 500 } }, 1)).toEqual([]);
  });

  it("names thresholds in the person's units", () => {
    expect(snowThresholdLabel(4, false)).toBe("4 in");
    expect(snowThresholdLabel(4, true)).toBe("10 cm");
    expect(snowThresholdLabel(8, true)).toBe("20 cm");
    expect(snowThresholdLabel(12, true)).toBe("30 cm");
  });

  it("only accepts known settings", () => {
    expect(isSnowMap("depth")).toBe(true);
    expect(isSnowMap("24h")).toBe(false);
    expect(isSnowThreshold(8)).toBe(true);
    expect(isSnowThreshold("8")).toBe(false);
  });
});
