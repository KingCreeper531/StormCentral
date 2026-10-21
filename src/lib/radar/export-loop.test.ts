import { afterEach, describe, expect, it } from "vitest";
import { setTimePrefs } from "../clock";
import { exportFilename, exportFileTime } from "./export-loop";

const at = (iso: string) => Date.parse(iso);

describe("export file names", () => {
  afterEach(() => setTimePrefs({ zone: "auto" }));

  it("names the file after the newest observed scan, not the forecast past it", () => {
    const frames = [
      { time: at("2026-10-07T19:02:00Z") },
      { time: at("2026-10-08T00:12:00Z") },
      { time: at("2026-10-08T00:22:00Z"), forecast: true },
      { time: at("2026-10-08T06:00:00Z"), forecast: true },
    ];
    expect(exportFileTime(frames)).toBe(at("2026-10-08T00:12:00Z"));
    expect(exportFilename(exportFileTime(frames), "gif", "America/Chicago")).toBe("stormcentral-radar-2026-10-07-1912.gif");
    // Only forecast frames: the newest of those.
    expect(exportFileTime(frames.slice(2))).toBe(at("2026-10-08T06:00:00Z"));
  });

  it("reads the time in the same zone as the caption", () => {
    const t = at("2026-10-08T00:12:00Z");
    // UTC+14, so surely not the zone the tests run in.
    const kiritimati = "stormcentral-radar-2026-10-08-1412.mp4";
    expect(exportFilename(t, "mp4", "Pacific/Kiritimati")).toBe(kiritimati);
    // The "device" time zone setting: the caption reads the device's clock, and so does the file name.
    setTimePrefs({ zone: "device" });
    expect(exportFilename(t, "mp4", "Pacific/Kiritimati")).toBe(exportFilename(t, "mp4"));
    expect(exportFilename(t, "mp4", "Pacific/Kiritimati")).not.toBe(kiritimati);
  });
});
