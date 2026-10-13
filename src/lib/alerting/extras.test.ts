import { describe, expect, it } from "vitest";
import type { Forecast } from "../api/open-meteo";
import type { PostDto } from "../community";
import { briefingText, checkBriefing, checkLightning, checkSpotterReports, parseBriefingTime, type ExtrasIO } from "./extras";
import type { AppNotification, WatchConfig } from "./types";

const NOW = Date.UTC(2026, 9, 13, 13, 0); // 8 AM in Chicago (UTC-5)

function cfg(patch: Partial<WatchConfig["settings"]> = {}, extra: Partial<WatchConfig> = {}): WatchConfig {
  return {
    settings: { enabled: true, level: "warnings", watchCurrent: true, ...patch },
    places: [
      { id: "current", name: "Norman, OK", lat: 35.22, lon: -97.44 },
      { id: "home", name: "Home", lat: 35.4, lon: -97.5 },
    ],
    rules: [],
    units: { temp: "F", wind: "mph" },
    drone: { altitudeM: 120, profileId: "mini" },
    community: { url: "https://example.test", username: "me", muted: ["Troll"] },
    ...extra,
  };
}

function io(over: Partial<ExtrasIO> = {}) {
  const kv = new Map<string, string>();
  const sent: AppNotification[] = [];
  const base: ExtrasIO = {
    now: () => NOW,
    localClock: () => ({ minutes: 8 * 60, day: "2026-10-13" }),
    fetchForecast: async () => forecast(),
    fetchLightningKm: async () => null,
    fetchNearbyReports: async () => [],
    kvGet: (k) => kv.get(k) ?? null,
    kvSet: (k, v) => void kv.set(k, v),
    notify: (n) => void sent.push(n),
    ...over,
  };
  return { io: base, sent, kv };
}

function forecast(): Forecast {
  const day0 = Date.UTC(2026, 9, 13, 5) / 1000; // local midnight
  const hours = Array.from({ length: 24 }, (_, i) => day0 + i * 3600);
  return {
    lat: 35.22,
    lon: -97.44,
    elevation: 350,
    timezone: "America/Chicago",
    utcOffsetSeconds: -5 * 3600,
    fetchedAt: 0,
    current: {} as Forecast["current"],
    hourly: { time: hours, precipProb: hours.map((_, i) => (i === 15 ? 80 : 10)) } as unknown as Forecast["hourly"],
    daily: { time: [day0, day0 + 86_400], tMax: [26, 20], tMin: [15, 10], code: [95, 3], precipProbMax: [80, 0], gustMax: [16, 5], uvMax: [7, 3] } as unknown as Forecast["daily"],
    minutely15: null,
  };
}

const post = (over: Partial<PostDto>): PostDto => ({
  id: "p1",
  body: "Quarter size hail falling now",
  category: "hail",
  severity: 1,
  lat: 35.2,
  lon: -97.4,
  place: "Norman",
  createdAt: NOW - 10 * 60_000,
  image: null,
  conditions: null,
  author: { username: "spotter1", displayName: "Spotter One", avatarHue: 1, avatarUrl: null, reputation: 0, developer: false },
  verifications: 0,
  comments: 0,
  viewerVerified: false,
  isOwn: false,
  hidden: false,
  distanceKm: 12.9,
  ...over,
});

describe("lightning", () => {
  it("notifies per place with a cooldown, in the person's units", async () => {
    const t = io({ fetchLightningKm: async (lat) => (lat > 35.3 ? 9.7 : null) });
    const c = cfg({ lightning: { enabled: true, radiusKm: 16 } });
    expect(await checkLightning(c, t.io)).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ title: "Lightning near Home", kind: "lightning" });
    expect(t.sent[0]!.body).toContain("about 6 mi away");
    expect(await checkLightning(c, t.io)).toHaveLength(0); // cooling down
  });

  it("does nothing when off or when notifications are off", async () => {
    const t = io({ fetchLightningKm: async () => 2 });
    expect(await checkLightning(cfg(), t.io)).toHaveLength(0);
    expect(await checkLightning(cfg({ enabled: false, lightning: { enabled: true, radiusKm: 16 } }), t.io)).toHaveLength(0);
  });
});

describe("spotter reports", () => {
  it("announces new, severe, recent reports from others once", async () => {
    const reports = [
      post({ id: "a" }),
      post({ id: "own", isOwn: true }),
      post({ id: "self", author: { ...post({}).author, username: "ME" } }),
      post({ id: "muted", author: { ...post({}).author, username: "troll" } }),
      post({ id: "old", createdAt: NOW - 3 * 3_600_000 }),
      post({ id: "fog", category: "fog", severity: 1 }),
      post({ id: "big", category: "observation", severity: 3 }),
    ];
    const t = io({ fetchNearbyReports: async () => reports });
    const c = cfg({ spotter: { enabled: true, radiusKm: 40 } }, { places: [{ id: "current", name: "Norman, OK", lat: 35.22, lon: -97.44 }] });
    const sent = await checkSpotterReports(c, t.io);
    expect(sent.map((n) => n.title)).toEqual(["Hail reported 8 mi from Norman, OK", "Dangerous weather reported 8 mi from Norman, OK"]);
    expect(sent[0]!.body).toBe("Spotter One: Quarter size hail falling now");
    expect(await checkSpotterReports(c, t.io)).toHaveLength(0);
  });

  it("needs a spotter network", async () => {
    const t = io({ fetchNearbyReports: async () => [post({})] });
    expect(await checkSpotterReports(cfg({ spotter: { enabled: true, radiusKm: 40 } }, { community: null }), t.io)).toHaveLength(0);
  });
});

describe("morning briefing", () => {
  it("reads times", () => {
    expect(parseBriefingTime("06:30")).toBe(390);
    expect(parseBriefingTime("25:00")).toBe(420);
    expect(parseBriefingTime(undefined)).toBe(420);
  });

  it("summarises today", () => {
    expect(briefingText(forecast(), cfg(), NOW)).toBe("Thunderstorm. High 79°, low 59°. 80% chance of rain, most likely around 3 PM. Gusts to 36 mph. UV 7 (high).");
  });

  it("sends once a day, from the chosen time until three hours later", async () => {
    const c = cfg({ briefing: { enabled: true, time: "07:00" } });
    const t = io();
    expect((await checkBriefing(c, t.io))?.title).toBe("Today in Norman, OK");
    expect(await checkBriefing(c, t.io)).toBeNull(); // already sent today
    const early = io({ localClock: () => ({ minutes: 6 * 60 + 59, day: "2026-10-13" }) });
    expect(await checkBriefing(c, early.io)).toBeNull();
    const late = io({ localClock: () => ({ minutes: 10 * 60 + 1, day: "2026-10-13" }) });
    expect(await checkBriefing(c, late.io)).toBeNull();
  });
});
