import { describe, expect, it } from "vitest";
import { boltsFromFile, flashesBbox, flashesUrl, lightningTileUrl, parseBbox } from "./lightning";

describe("lightning", () => {
  it("ages GLM flashes from the file's time and drops the expired", () => {
    const file = { generated: "2026-10-20T18:48:53Z", minutes: 15, flashes: [[-97.5, 35.3, 890], [-96, 36, 30], [Number.NaN, 1, 1]] as [number, number, number][] };
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

  it("asks for the flashes of whole 10° squares around the view", () => {
    // Turks and Caicos, zoomed in.
    expect(flashesBbox(-72.6, 21.2, -71.1, 22.1)).toEqual([-80, 20, -70, 30]);
    // A tiny view on a square's edge still gets a whole square.
    expect(flashesBbox(-80, 20, -80, 20)).toEqual([-80, 20, -70, 30]);
    // Across the date line, or past a world's width: every longitude.
    expect(flashesBbox(170, 10, 190, 30)).toEqual([-180, 10, 180, 30]);
    expect(flashesBbox(-400, -95, 400, 95)).toEqual([-180, -90, 180, 90]);
    expect(flashesUrl([-80, 20, -70, 30])).toBe("/api/lightning/flashes?bbox=-80,20,-70,30");
  });

  it("only accepts real areas", () => {
    expect(parseBbox("-80,20,-70,30")).toEqual([-80, 20, -70, 30]);
    for (const bad of [null, "", "1,2,3", "-70,20,-80,30", "-80,30,-70,20", "-190,0,0,10", "a,b,c,d", "-80,,-70,30"]) expect(parseBbox(bad), String(bad)).toBeNull();
  });
});
