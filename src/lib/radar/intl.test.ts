import { describe, expect, it } from "vitest";
import { gridTimes, INTL_RADARS, intlRadarsInView, jmaStamp, matchFrames, parseJmaTimes } from "./intl";

describe("international radar", () => {
  it("builds WMS tile templates with the time", () => {
    const url = INTL_RADARS.eccc.tileUrl("2026-10-19T17:18:00Z");
    expect(url).toContain("LAYERS=RADAR_1KM_RRAI");
    expect(url).toContain("BBOX={bbox-epsg-3857}");
    expect(url).toContain("TIME=2026-10-19T17%3A18%3A00Z");
    expect(INTL_RADARS.knmi.tileUrl("2026-10-19T17:20:00Z")).toMatch(/^https:\/\/geoservices\.knmi\.nl\/adagucserver\?dataset=RADAR&SERVICE=WMS/);
  });

  it("uses JMA's stamps for its XYZ tiles and keeps observed frames only", () => {
    expect(jmaStamp("2026-10-19T17:25:00Z")).toBe("20261019172500");
    expect(INTL_RADARS.jma.tileUrl("2026-10-19T17:25:00Z")).toBe("https://www.jma.go.jp/bosai/jmatile/data/nowc/20261019172500/none/20261019172500/surf/hrpns/{z}/{x}/{y}.png");
    expect(
      parseJmaTimes([
        { basetime: "20261019172500", validtime: "20261019172500" },
        { basetime: "20261019172500", validtime: "20261019173000" },
        { basetime: "20261019172000", validtime: "20261019172000" },
      ]),
    ).toEqual(["2026-10-19T17:20:00Z", "2026-10-19T17:25:00Z"]);
  });

  it("lists grid times up to the newest that should be out", () => {
    const now = Date.parse("2026-10-19T17:33:20Z");
    const t = gridTimes({ stepMin: 5, latencyMin: 10 }, now, 20);
    expect(t.at(-1)).toBe("2026-10-19T17:20:00Z");
    expect(t[0]).toBe("2026-10-19T17:00:00Z");
    expect(t).toHaveLength(5);
  });

  it("picks the sources in view", () => {
    expect(intlRadarsInView([-100, 30, -80, 45]).map((r) => r.id)).toEqual(["eccc"]);
    expect(intlRadarsInView([3, 47, 12, 55]).map((r) => r.id)).toEqual(["dwd", "knmi"]);
    expect(intlRadarsInView([130, 30, 140, 40]).map((r) => r.id)).toEqual(["jma"]);
    expect(intlRadarsInView(null)).toEqual([]);
  });

  it("time-matches a source to the loop, sharing frames and leaving gaps empty", () => {
    const times = ["2026-10-19T17:00:00Z", "2026-10-19T17:06:00Z", "2026-10-19T17:12:00Z"];
    const loop = ["2026-10-19T16:40:00Z", "2026-10-19T17:02:00Z", "2026-10-19T17:05:00Z", "2026-10-19T17:13:00Z", "2026-10-19T17:40:00Z"].map(Date.parse);
    const m = matchFrames(INTL_RADARS.eccc, times, loop, 14);
    // 16:40 is before the first scan; 17:05 takes 17:06 (a minute of clock slack); 17:40 is too far past 17:12.
    expect(m.index).toEqual([-1, 0, 1, 2, -1]);
    expect(m.frames.map((f) => new Date(f.time).toISOString())).toEqual(["2026-10-19T17:00:00.000Z", "2026-10-19T17:06:00.000Z", "2026-10-19T17:12:00.000Z"]);
    expect(m.frames[0]!.bounds).toEqual(INTL_RADARS.eccc.bounds);
  });
});
