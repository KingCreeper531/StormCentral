import { describe, expect, it } from "vitest";
import type { Forecast } from "../api/open-meteo";
import type { ActivityItem, PostDto } from "../community";
import type { IncomingStorm } from "../storm-eta";
import { briefingText, checkActivity, checkBriefing, checkLightning, checkRainSoon, checkSpotterReports, checkStorms, parseBriefingTime, type ExtrasIO } from "./extras";
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
  author: { username: "spotter1", displayName: "Spotter One", avatarHue: 1, avatarUrl: null, reputation: 0, developer: false, trusted: false },
  verifications: 0,
  comments: 0,
  viewerVerified: false,
  isOwn: false,
  hidden: false,
  nws: null,
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

describe("rain starting soon", () => {
  const T = Math.floor(NOW / 1000 / 900) * 900; // slot boundary before NOW
  const times = Array.from({ length: 12 }, (_, i) => T + (i + 1) * 900);
  const wetFrom = (k: number) => times.map((_, i) => (i >= k ? 0.4 : 0));

  it("notifies once per spell within the lead time, in Spanish when asked", async () => {
    const { io: x, sent, kv } = io({ fetchNowcast: async () => ({ times, precip: wetFrom(2), tempC: 12 }) });
    const c = cfg({ rain: { enabled: true, leadMin: 30 } }, { lang: "es" });
    const n = await checkRainSoon(c, x);
    expect(n?.title).toBe("Lluvia en unos 30 min");
    expect(n?.body).toContain("Norman, OK");
    expect(sent).toHaveLength(1);
    // Ten minutes later: already announced.
    kv.delete("rain-checked");
    expect(await checkRainSoon(c, { ...x, now: () => NOW + 10 * 60_000 })).toBeNull();
  });

  it("stays quiet beyond the lead time, when dry, or already raining", async () => {
    const run = async (precip: number[]) => {
      const { io: x } = io({ fetchNowcast: async () => ({ times, precip, tempC: 12 }) });
      return checkRainSoon(cfg({ rain: { enabled: true, leadMin: 15 } }), x);
    };
    expect(await run(wetFrom(6))).toBeNull();
    expect(await run(times.map(() => 0))).toBeNull();
    expect(await run(wetFrom(0))).toBeNull();
  });
});

describe("storms heading your way", () => {
  const storm = (over: Partial<IncomingStorm> = {}): IncomingStorm => ({
    id: "TLX-A3",
    etaMin: 22,
    arrivesAt: NOW + 22 * 60_000,
    level: 2,
    distanceKm: 20,
    headingDeg: 45,
    speedKt: 30,
    maxHailIn: 1.25,
    maxDbz: 62,
    tvs: null,
    meso: null,
    radar: "TLX",
    stormId: "A3",
    lat: 35.1,
    lon: -97.6,
    ...over,
  });

  it("announces the soonest storm per place once, with hail and motion", async () => {
    const { io: x, sent } = io({ fetchIncomingStorms: async () => [storm()] });
    const c = cfg({ storms: { enabled: true } });
    const out = await checkStorms(c, x);
    expect(out).toHaveLength(2); // current location and Home
    expect(out[0]!.title).toBe("Hailstorm heading for Norman, OK");
    expect(out[0]!.body).toMatch(/in about 20 min\)\. Hail up to 1\.25 in possible\. Moving northeast at 35 mph\./);
    expect(await checkStorms(c, x)).toHaveLength(0);
    expect(sent).toHaveLength(2);
  });

  it("calls out rotation", async () => {
    const { io: x } = io({ fetchIncomingStorms: async () => [storm({ tvs: "TVS", level: 4 })] });
    const [n] = await checkStorms(cfg({ storms: { enabled: true }, watchCurrent: true }), x);
    expect(n!.title).toBe("Storm with rotation heading for Norman, OK");
    expect(n!.body).toContain("tornado warning");
  });
});

describe("activity on your reports", () => {
  const item = (over: Partial<ActivityItem>): ActivityItem => ({
    id: "c:1",
    kind: "comment",
    at: NOW - 60_000,
    postId: "p1",
    postPreview: "Hail in Moore",
    actor: { username: "sam", displayName: "Sam" },
    text: "Same here, quarter size",
    ...over,
  });

  it("starts from the first run, then announces new confirmations and comments", async () => {
    let since = 0;
    const { io: x, sent } = io({
      fetchActivity: async (s) => {
        since = s;
        return [item({}), item({ id: "v:p1:kim", kind: "confirm", actor: { username: "kim", displayName: "Kim" }, text: null })];
      },
    });
    const c = cfg({ activity: { enabled: true } });
    expect(await checkActivity(c, x)).toHaveLength(0);
    const out = await checkActivity(c, { ...x, now: () => NOW + 60_000 });
    expect(since).toBe(NOW);
    expect(out.map((n) => n.title)).toEqual(["Sam commented on your report", "Kim confirmed your report"]);
    expect(sent).toHaveLength(2);
  });

  it("announces the NWS confirming a report", async () => {
    const { io: x } = io({
      fetchActivity: async () => [item({ id: "n:p1", kind: "nws", actor: { username: "", displayName: "National Weather Service" }, text: null })],
    });
    const c = cfg({ activity: { enabled: true } });
    await checkActivity(c, x);
    const [n] = await checkActivity(c, { ...x, now: () => NOW + 60_000 });
    expect(n?.title).toBe("The NWS confirmed your report");
    expect(n?.body).toBe("“Hail in Moore” It matches an official NWS storm report and counts as 5 confirmations.");
  });
});
