import { describe, expect, it } from "vitest";
import { getSite } from "./site-utils";
import { ARCHIVE_EVENTS, ARCHIVE_START, archiveTime, fromWallTime, isoMinute, toWallTime } from "./archive";

describe("archiveTime", () => {
  const now = Date.UTC(2026, 9, 20, 12, 0);
  it("reads ISO times and epoch ms, to the minute", () => {
    expect(archiveTime("2013-05-20T20:00:42Z", now)).toBe(Date.UTC(2013, 4, 20, 20, 0));
    expect(archiveTime(String(Date.UTC(2013, 4, 20, 20, 0)), now)).toBe(Date.UTC(2013, 4, 20, 20, 0));
    expect(archiveTime(Date.UTC(1999, 4, 4), now)).toBe(Date.UTC(1999, 4, 4));
  });
  it("refuses what isn't in the archive", () => {
    expect(archiveTime("1994-12-31T23:59Z", now)).toBeNull();
    expect(archiveTime(ARCHIVE_START, now)).toBe(ARCHIVE_START);
    expect(archiveTime("2026-10-21T00:00Z", now)).toBeNull();
    expect(archiveTime("yesterday", now)).toBeNull();
    expect(archiveTime("", now)).toBeNull();
    expect(archiveTime(null, now)).toBeNull();
  });
  it("writes the minute the way the upstream archives take it", () => {
    expect(isoMinute(Date.UTC(2013, 4, 20, 20, 5, 30))).toBe("2013-05-20T20:05Z");
  });
});

describe("wall-clock times", () => {
  it("round-trips through a zone, daylight saving or not", () => {
    // 3:00 PM CDT (UTC-5) and 3:00 PM CST (UTC-6).
    expect(fromWallTime("2013-05-20T15:00", "America/Chicago")).toBe(Date.UTC(2013, 4, 20, 20, 0));
    expect(fromWallTime("2013-01-20T15:00", "America/Chicago")).toBe(Date.UTC(2013, 0, 20, 21, 0));
    expect(toWallTime(Date.UTC(2013, 4, 20, 20, 0), "America/Chicago")).toBe("2013-05-20T15:00");
    expect(toWallTime(Date.UTC(1999, 4, 4, 0, 0), "America/Chicago")).toBe("1999-05-03T19:00");
    expect(fromWallTime("2026-10-20T08:30", "UTC")).toBe(Date.UTC(2026, 9, 20, 8, 30));
  });
  it("refuses what isn't a datetime-local value", () => {
    expect(fromWallTime("", "UTC")).toBeNull();
    expect(fromWallTime("2013-05-20", "UTC")).toBeNull();
  });
});

describe("archive events", () => {
  it("are all inside the archive, with a radar and a place", () => {
    for (const e of ARCHIVE_EVENTS) {
      expect(archiveTime(e.at)).not.toBeNull();
      expect(getSite(e.site), e.site).toBeDefined();
      expect(Math.abs(e.lat)).toBeLessThan(90);
    }
    expect(new Set(ARCHIVE_EVENTS.map((e) => e.id)).size).toBe(ARCHIVE_EVENTS.length);
  });
});
