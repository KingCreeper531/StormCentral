import { describe, expect, it } from "vitest";
import { boltsFromFile, lightningTileUrl } from "./lightning";

describe("lightning", () => {
  it("ages GLM flashes from the file's time and drops the expired", () => {
    const file = { generated: "2026-10-20T18:48:53Z", minutes: 15, flashes: [[-97.5, 35.3, 890, 12], [-96, 36, 30, 4], [Number.NaN, 1, 1, 1]] as [number, number, number, number][] };
    const now = Date.parse(file.generated) + 20_000;
    expect(boltsFromFile(file, now)).toEqual([{ lon: -96, lat: 36, age: 50 }]);
    expect(boltsFromFile({ ...file, generated: "nope" }, now)).toEqual([]);
  });

  it("asks nowCOAST for density-grid tiles, a new address per update", () => {
    const url = lightningTileUrl(7);
    expect(url).toContain("layers=ldn_lightning_strike_density");
    expect(url).toContain("bbox={bbox-epsg-3857}");
    expect(url).toContain("_=7");
    expect(lightningTileUrl(8)).not.toBe(url);
  });
});
