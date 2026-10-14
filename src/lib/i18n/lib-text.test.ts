import { describe, expect, it } from "vitest";
import { suspensionText, PERMANENT_SUSPENSION } from "../community";
import { stormTitle } from "../feeds/tropical-parse";
import { satelliteLabel } from "../radar/satellite";
import { timeAgo } from "../time";
import { clockIn } from "../weather/view";
import { describeCode } from "../weather/wmo";
import { translator } from "./core";
import { ES } from "./es";

const es = translator("es");
const NOW = Date.UTC(2026, 9, 14, 18);

describe("lib text in Spanish", () => {
  it("timeAgo", () => {
    expect(timeAgo(NOW - 10_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 10_000, NOW, es)).toBe("hace un momento");
    expect(timeAgo(NOW - 5 * 60_000, NOW, es)).toMatch(/^hace 5 min/);
    expect(timeAgo(NOW - 3 * 86_400_000, NOW, es)).toMatch(/^hace 3 d/);
    expect(timeAgo(NOW - 5 * 60_000, NOW, translator("en"))).toBe("5 min. ago");
  });

  it("clock times in the display locale", () => {
    expect(clockIn("UTC", NOW, "es-US")).toMatch(/^6:00\s?p\.\s?m\./);
    expect(clockIn("UTC", NOW, "en-US")).toMatch(/^6:00\s?PM/);
  });

  it("suspension notices", () => {
    expect(suspensionText(PERMANENT_SUSPENSION, es)).toBe("Esta cuenta fue suspendida.");
    expect(suspensionText(Date.UTC(2026, 9, 20), es)).toMatch(/^Esta cuenta está suspendida hasta el 20 oct/);
    expect(suspensionText(Date.UTC(2026, 9, 20))).toBe("This account is suspended until Oct 20, 2026.");
  });

  it("storm titles and satellite captions", () => {
    expect(stormTitle("HU", "Milton", es)).toBe("Huracán Milton");
    expect(stormTitle("XX", "Nadine")).toBe("Tropical Cyclone Nadine");
    expect(satelliteLabel("infrared", NOW, "UTC", "east", es)).toMatch(/^GOES-East, infrarrojo, 6:00\s?p\.\s?m\./);
  });

  it("covers every condition label", () => {
    for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) {
      expect(ES[describeCode(code).label], describeCode(code).label).toBeTruthy();
    }
  });
});
