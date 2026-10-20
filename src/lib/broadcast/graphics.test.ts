import { describe, expect, it } from "vitest";
import type { WeatherAlert } from "../api/types";
import { translator } from "../i18n";
import { broadcastWarnings, countdown, EMERGENCY_COLOR, shortAreas, styleOf, tickerItems, warningCounts, warningLowerThird, warningName } from "./graphics";

const NOW = Date.parse("2026-10-20T22:00:00Z");
const alert = (p: Partial<WeatherAlert>): WeatherAlert =>
  ({
    id: p.event ?? "x",
    event: "Tornado Warning",
    tags: [],
    color: "#f00",
    rank: 1,
    areaDesc: "Oklahoma, OK; Cleveland, OK",
    expires: "2026-10-20T22:45:00Z",
    ends: null,
    ...p,
  }) as WeatherAlert;

describe("broadcast graphics", () => {
  const tor = alert({ id: "t", rank: 9 });
  const svr = alert({ id: "s", event: "Severe Thunderstorm Warning", rank: 5, areaDesc: "Logan; Kingfisher; Canadian; Blaine; Major" });
  const ffw = alert({ id: "f", event: "Flash Flood Warning", rank: 4, expires: "2026-10-20T21:00:00Z" });
  const watch = alert({ id: "w", event: "Tornado Watch", rank: 8 });
  const spotter = alert({ id: "sp", source: "spotter", rank: 10 });

  it("follow official, unexpired warnings, most serious first", () => {
    expect(broadcastWarnings([svr, watch, ffw, spotter, tor, tor], NOW).map((a) => a.id)).toEqual(["t", "s"]);
  });

  it("count each kind", () => {
    expect(warningCounts([tor, svr, alert({ id: "t2" })])).toEqual([
      { code: "TOR", label: "Tornado", n: 2, color: "#ff3b3b" },
      { code: "SVR", label: "Severe storm", n: 1, color: "#ffb020" },
    ]);
  });

  it("name emergencies and PDS warnings, and colour them apart", () => {
    const emerg = alert({ tags: ["TORNADO EMERGENCY"] });
    expect(warningName(emerg)).toBe("Tornado Emergency");
    expect(styleOf(emerg)).toEqual({ code: "EMERG", color: EMERGENCY_COLOR });
    expect(warningName(alert({ tags: ["PDS"] }))).toBe("PDS Tornado Warning");
    expect(warningName(tor, translator("es"))).toBe("Aviso de tornado");
  });

  it("shorten long area lists", () => {
    expect(shortAreas("Oklahoma")).toBe("Oklahoma");
    expect(shortAreas("A; B; C")).toBe("A, B and C");
    expect(shortAreas("A; B; C; D; E")).toBe("A, B and 3 more");
  });

  it("write the ticker and the lower third", () => {
    const items = tickerItems([tor, svr], "America/Chicago");
    expect(items[0]).toEqual({ code: "TOR", color: "#ff3b3b", text: "Tornado Warning: Oklahoma, OK and Cleveland, OK until 5:45 PM" });
    expect(tickerItems([tor, svr, tor], "America/Chicago", undefined, 2).at(-1)!.text).toBe("and 1 more");
    expect(warningLowerThird(tor, "America/Chicago")).toEqual({
      title: "TORNADO WARNING",
      subtitle: "Oklahoma, OK and Cleveland, OK · until 5:45 PM",
      color: "#ff3b3b",
      ends: "2026-10-20T22:45:00Z",
    });
  });

  it("count down to the end", () => {
    expect(countdown("2026-10-20T22:12:04Z", NOW)).toBe("12:04");
    expect(countdown("2026-10-21T00:05:09Z", NOW)).toBe("2:05:09");
    expect(countdown("2026-10-20T21:00:00Z", NOW)).toBe("0:00");
  });
});
