import { describe, expect, it } from "vitest";
import type { WeatherAlert } from "../api/types";
import { alertMatchesLevel, checkRules, checkWarnings, widgetSnapshot, type EngineIO } from "./engine";
import { clockAt, clockFromIso, dayKeyAt, hashId } from "./format";
import { describeRule, firstHit, fromDisplay, toDisplay } from "./metrics";
import type { AppNotification, WatchConfig } from "./types";

const NOW = Date.parse("2026-05-20T21:00:00Z");

function alert(id: string, event: string, over: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id,
    event,
    headline: `${event} issued for Cleveland County`,
    severity: "Extreme",
    urgency: "Immediate",
    certainty: "Observed",
    sent: "2026-05-20T20:50:00Z",
    effective: "2026-05-20T20:50:00Z",
    expires: "2026-05-20T21:45:00Z",
    ends: null,
    areaDesc: "Cleveland, OK",
    sender: "NWS Norman OK",
    description: "",
    instruction: null,
    hazards: {},
    tags: [],
    color: "#ff0000",
    rank: event.includes("Tornado") ? 90 : 50,
    motion: null,
    geometry: null,
    ...over,
  };
}

function fakeIO(alerts: Record<string, WeatherAlert[]>) {
  const kv = new Map<string, string>();
  const sent: AppNotification[] = [];
  const io: EngineIO = {
    now: () => NOW,
    fetchAlerts: async (lat) => alerts[lat.toFixed(2)] ?? [],
    fetchForecast: async () => {
      throw new Error("not needed");
    },
    fetchAir: async () => {
      throw new Error("not needed");
    },
    kvGet: (k) => kv.get(k) ?? null,
    kvSet: (k, v) => void kv.set(k, v),
    notify: (n) => void sent.push(n),
  };
  return { io, kv, sent };
}

const cfg = (over: Partial<WatchConfig["settings"]> = {}): WatchConfig => ({
  settings: { enabled: true, level: "warnings", watchCurrent: true, ...over },
  places: [
    { id: "a", name: "Norman, OK", lat: 35.22, lon: -97.44 },
    { id: "b", name: "Moore, OK", lat: 35.34, lon: -97.49 },
  ],
  rules: [],
  units: { temp: "F", wind: "mph" },
  drone: { altitudeM: 120, profileId: "sub250" },
});

describe("alert levels", () => {
  it("keeps warnings and emergencies, drops tests and (by default) watches", () => {
    expect(alertMatchesLevel(alert("1", "Tornado Warning"), "warnings")).toBe(true);
    expect(alertMatchesLevel(alert("2", "Tornado Watch"), "warnings")).toBe(false);
    expect(alertMatchesLevel(alert("2", "Tornado Watch"), "all")).toBe(true);
    expect(alertMatchesLevel(alert("3", "Test Message"), "all")).toBe(false);
    expect(alertMatchesLevel(alert("4", "Special Weather Statement", { tags: ["TORNADO EMERGENCY"] }), "warnings")).toBe(true);
  });
});

describe("checkWarnings", () => {
  it("notifies once per alert and place, most severe first", async () => {
    const tor = alert("tor", "Tornado Warning", { tags: ["PDS"] });
    const svr = alert("svr", "Severe Thunderstorm Warning");
    const { io, sent } = fakeIO({ "35.22": [svr, tor], "35.34": [tor] });
    const first = await checkWarnings(cfg(), io);
    expect(first.sent.map((n) => n.title)).toEqual(["Tornado Warning: Norman, OK", "Tornado Warning: Moore, OK", "Severe Thunderstorm Warning: Norman, OK"]);
    expect(first.sent[0]!.body).toMatch(/^Particularly dangerous situation\. Until /);
    expect(new Set(sent.map((n) => n.id)).size).toBe(3);
    const again = await checkWarnings(cfg(), io);
    expect(again.sent).toHaveLength(0);
  });

  it("stays quiet when disabled but still reports alerts, and skips expired ones", async () => {
    const old = alert("old", "Flash Flood Warning", { expires: "2026-05-20T20:00:00Z" });
    const { io } = fakeIO({ "35.22": [old] });
    const off = await checkWarnings(cfg({ enabled: false }), io);
    expect(off.sent).toHaveLength(0);
    expect(off.alerts.get("a")).toHaveLength(1);
    expect((await checkWarnings(cfg(), io)).sent).toHaveLength(0);
  });

  it("caps a burst at five notifications", async () => {
    const many = Array.from({ length: 8 }, (_, i) => alert(`w${i}`, "Severe Thunderstorm Warning"));
    const { io } = fakeIO({ "35.22": many });
    expect((await checkWarnings(cfg(), io)).sent).toHaveLength(5);
    // The rest were marked seen, not queued for the next check.
    expect((await checkWarnings(cfg(), io)).sent).toHaveLength(0);
  });
});

describe("checkRules", () => {
  it("ignores rules for unknown places without fetching", async () => {
    const { io } = fakeIO({});
    const c = { ...cfg(), rules: [{ id: "r", placeId: "gone", metric: "temp" as const, op: "above" as const, value: 0, hours: 24, enabled: true }] };
    expect((await checkRules(c, io)).sent).toHaveLength(0);
  });
});

describe("widget snapshot", () => {
  it("carries the top unexpired alert without a forecast", () => {
    const s = widgetSnapshot({ id: "current", name: "Norman, OK", lat: 35.22, lon: -97.44 }, "F", null, [alert("svr", "Severe Thunderstorm Warning"), alert("tor", "Tornado Warning")], NOW);
    expect(s.now).toBeNull();
    expect(s.alert?.event).toBe("Tornado Warning");
  });
});

describe("format and metrics", () => {
  it("formats clock times at a UTC offset without Intl", () => {
    expect(clockAt(NOW, -5 * 3600)).toBe("4 PM");
    expect(dayKeyAt(Date.parse("2026-05-21T03:00:00Z"), -5 * 3600)).toBe(dayKeyAt(NOW, -5 * 3600));
    expect(clockFromIso("2026-05-20T16:45:00-05:00")).toBe("4:45 PM");
  });

  it("hashes to a positive 31-bit integer", () => {
    for (const s of ["", "a", "tor@current", "x".repeat(500)]) {
      const h = hashId(s);
      expect(Number.isInteger(h) && h > 0 && h < 2 ** 31).toBe(true);
    }
  });

  it("round-trips display units and describes rules", () => {
    const units = { temp: "F" as const, wind: "mph" as const };
    expect(toDisplay("temp", fromDisplay("temp", 50, units), units)).toBeCloseTo(50);
    expect(toDisplay("wind", fromDisplay("wind", 15, units), units)).toBeCloseTo(15);
    expect(describeRule("bite", "above", 70, units)).toBe("Bite index above 70");
    expect(describeRule("temp", "below", 0, units)).toBe("Temperature below 32°F");
  });

  it("finds the first hour that meets a threshold", () => {
    const series = [
      { t: 1, v: null },
      { t: 2, v: 5 },
      { t: 3, v: 12 },
    ];
    expect(firstHit(series, "above", 10)).toEqual({ t: 3, v: 12 });
    expect(firstHit(series, "below", 6)).toEqual({ t: 2, v: 5 });
    expect(firstHit(series, "below", 1)).toBeNull();
  });
});
