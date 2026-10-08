import { describe, expect, it } from "vitest";
import { hrrrFrames, hrrrInit, hrrrTileUrl } from "./hrrr";

const NOW = Date.parse("2026-05-20T21:07:00Z");

describe("HRRR future radar", () => {
  it("uses the newest run that is safely processed", () => {
    expect(new Date(hrrrInit(NOW)).toISOString()).toBe("2026-05-20T19:00:00.000Z");
  });

  it("builds IEM tile URLs with 4-digit forecast minutes", () => {
    expect(hrrrTileUrl(Date.parse("2026-05-20T19:00:00Z"), 90)).toContain("hrrr::REFD-F0090-202605201900/{z}/{x}/{y}.png");
  });

  it("covers the next hours after the last scan, on the 15-minute grid", () => {
    const frames = hrrrFrames(Date.parse("2026-05-20T21:05:00Z"), NOW, 6);
    expect(frames).toHaveLength(12);
    expect(new Date(frames[0]!.time).toISOString()).toBe("2026-05-20T21:30:00.000Z");
    expect(new Date(frames.at(-1)!.time).toISOString()).toBe("2026-05-21T03:00:00.000Z");
    expect(frames.every((f) => f.forecast && /F\d{4}-/.test(f.tileUrl))).toBe(true);
    expect(frames[0]!.tileUrl).toContain("REFD-F0150-");
  });

  it("returns nothing when turned off", () => {
    expect(hrrrFrames(NOW, NOW, 0)).toEqual([]);
  });
});
