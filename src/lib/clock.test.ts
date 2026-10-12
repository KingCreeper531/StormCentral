import { afterEach, describe, expect, it } from "vitest";
import { setTimePrefs, timePrefsVersion, withClock, zoneFor } from "./clock";
import { clockIn, fmtIn } from "./weather/view";

afterEach(() => setTimePrefs({ clock: "auto", zone: "auto" }));

const AT = Date.parse("2026-05-20T20:30:00Z");

describe("time preferences", () => {
  it("adds an hour cycle only to formats that show hours", () => {
    setTimePrefs({ clock: "24" });
    expect(withClock({ hour: "numeric" })).toEqual({ hour: "numeric", hourCycle: "h23" });
    expect(withClock({ weekday: "short" })).toEqual({ weekday: "short" });
    expect(fmtIn("America/Chicago", { hour: "numeric", minute: "2-digit" }).format(AT)).toMatch(/^15:30$/);
    setTimePrefs({ clock: "12" });
    expect(fmtIn("America/Chicago", { hour: "numeric", minute: "2-digit" }).format(AT)).toMatch(/3:30\s?PM/);
  });

  it("uses the device zone when asked", () => {
    expect(zoneFor("Asia/Tokyo")).toBe("Asia/Tokyo");
    setTimePrefs({ zone: "device" });
    expect(zoneFor("Asia/Tokyo")).toBeUndefined();
  });

  it("invalidates cached clock formatters on change", () => {
    const v = timePrefsVersion();
    setTimePrefs({ clock: "24" });
    expect(timePrefsVersion()).toBe(v + 1);
    expect(clockIn("America/Chicago", AT)).toMatch(/^15:30/);
  });
});
