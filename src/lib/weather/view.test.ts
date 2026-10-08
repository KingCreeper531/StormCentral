import { describe, expect, it } from "vitest";
import { clockIn } from "./view";

const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
const at = Date.parse("2026-10-07T19:37:00Z");
const plain = (tz: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(at);
// A zone whose clock never matches the device's (offsets differ by 5:45 or 5:30).
const elsewhere = plain("Asia/Kathmandu") === plain(device) ? "Asia/Kolkata" : "Asia/Kathmandu";

describe("clockIn", () => {
  it("formats in the given zone and omits the zone when the device clock agrees", () => {
    expect(clockIn(device, at)).toBe(plain(device));
    expect(clockIn(undefined, at)).toBe(plain(device));
  });

  it("names the zone when the location's clock differs from the device's", () => {
    const s = clockIn(elsewhere, at);
    expect(s.startsWith(plain(elsewhere))).toBe(true);
    expect(s.length).toBeGreaterThan(plain(elsewhere).length);
  });

  it("accepts ISO strings and Dates, and survives an unknown zone", () => {
    expect(clockIn(elsewhere, new Date(at).toISOString())).toBe(clockIn(elsewhere, new Date(at)));
    expect(clockIn("Not/AZone", at)).toBe(plain(device));
  });
});
