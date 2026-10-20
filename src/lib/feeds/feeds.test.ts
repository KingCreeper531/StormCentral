import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpError } from "../api/http";
import { localApi } from "../native/local-api";
import { alertsFeed, parseIemWarnings } from "./alerts";
import { FEEDS } from "./index";
import { radarScansFeed } from "./radar";
import { stormReportsFeed } from "./storm-reports";

const API = path.resolve(import.meta.dirname, "../../app/api");

/** Every route.ts under src/app/api that serves a feed, as its URL path. */
function feedRoutes(dir = API): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return feedRoutes(p);
    if (name !== "route.ts" || !readFileSync(p, "utf8").includes("feedRoute(")) return [];
    return ["/api/" + path.relative(API, dir).split(path.sep).join("/")];
  });
}

describe("feed registry", () => {
  it("serves exactly the feed routes, so the Android bundle stays in step with the server", () => {
    expect([...FEEDS.keys()].sort()).toEqual(feedRoutes().sort());
    for (const p of FEEDS.keys()) expect(existsSync(path.join(API, p.slice("/api/".length), "route.ts"))).toBe(true);
  });

  it("rejects bad parameters with a 400 before touching the network", async () => {
    await expect(alertsFeed.load(new URLSearchParams())).rejects.toMatchObject({ status: 400 });
    await expect(radarScansFeed.load(new URLSearchParams("site=../x&product=N0B"))).rejects.toMatchObject({ status: 400 });
  });
});

describe("localApi (Android bundle)", () => {
  it("routes /api paths to feeds and reports non-feed routes as unavailable", async () => {
    await expect(localApi("/api/alerts")).rejects.toMatchObject({ status: 400 });
    await expect(localApi("/api/rivers/?lat=x")).rejects.toMatchObject({ status: 400 });
    const err = await localApi("/api/posts?sort=new").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
  });

  it("honours an already-aborted signal", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(localApi("/api/space-weather", ctl.signal)).rejects.toBeDefined();
  });
});

describe("the radar archive", () => {
  it("rejects times outside it", async () => {
    await expect(alertsFeed.load(new URLSearchParams("at=1990-01-01T00:00Z"))).rejects.toMatchObject({ status: 400 });
    await expect(alertsFeed.load(new URLSearchParams("at=soon"))).rejects.toMatchObject({ status: 400 });
    await expect(radarScansFeed.load(new URLSearchParams("site=USCOMP&product=N0Q&end=2999-01-01T00:00Z"))).rejects.toMatchObject({ status: 400 });
    await expect(stormReportsFeed.load(new URLSearchParams("hours=6&end=nope"))).rejects.toMatchObject({ status: 400 });
  });

  it("is cached for a day once the time has settled", () => {
    const maxAge = (f: { maxAge: number | ((sp: URLSearchParams) => number) }, q: string) => (typeof f.maxAge === "number" ? f.maxAge : f.maxAge(new URLSearchParams(q)));
    expect(maxAge(alertsFeed, "at=2013-05-20T20:00Z")).toBe(86_400);
    expect(maxAge(alertsFeed, `at=${new Date().toISOString()}`)).toBe(60);
    expect(maxAge(radarScansFeed, "site=USCOMP&product=N0Q&end=2013-05-20T20:00Z")).toBe(86_400);
    expect(maxAge(radarScansFeed, "site=USCOMP&product=N0Q")).toBe(30);
    expect(maxAge(stormReportsFeed, "hours=6&end=2013-05-20T20:00Z")).toBe(86_400);
    // Late reports still come in the day after.
    expect(maxAge(stormReportsFeed, `hours=6&end=${new Date(Date.now() - 3 * 3_600_000).toISOString()}`)).toBe(120);
  });

  it("reads IEM's archived warnings like live ones", () => {
    const sv = {
      geometry: { type: "MultiPolygon", coordinates: [[[[-95.08, 38.11], [-95.08, 38.26], [-94.8, 38.56], [-95.08, 38.11]]]] },
      properties: {
        phenomena: "SV",
        significance: "W",
        ps: "Severe Thunderstorm Warning",
        wfo: "EAX",
        eventid: 53,
        year: 2013,
        polygon_begin: "2013-05-20T20:00:00Z",
        polygon_end: "2013-05-20T20:45:00Z",
        product_id: "201305202000-KEAX-WUUS53-SVREAX",
        issue: "2013-05-20T20:00:00Z",
        expire_utc: "2013-05-20T20:45:00Z",
        windtag: 60.0,
        hailtag: 1.0,
        tornadotag: null,
        damagetag: null,
        is_emergency: false,
        is_pds: false,
        floodtag_damage: null,
      },
    };
    const to = {
      geometry: { type: "Polygon", coordinates: [[[-88.9, 36.6], [-88.5, 36.6], [-88.5, 36.9], [-88.9, 36.6]]] },
      properties: { ...sv.properties, phenomena: "TO", ps: "Tornado Warning", wfo: "PAH", eventid: 51, product_id: "202112110323-KPAH-WFUS53-TORPAH", windtag: null, tornadotag: "OBSERVED", damagetag: "CATASTROPHIC", is_emergency: true },
    };
    const river = { geometry: sv.geometry, properties: { ...sv.properties, phenomena: "FL", ps: "Flood Warning" } };
    const noShape = { geometry: null, properties: sv.properties };
    const [first, second, ...rest] = parseIemWarnings([sv, river, to, noShape]);
    expect(rest).toEqual([]);
    expect(first).toMatchObject({ id: "iem-PAH-TO.W-2013-51", event: "Tornado Warning", tags: ["TORNADO EMERGENCY", "OBSERVED"], sender: "NWS PAH", lean: true });
    expect(first!.rank).toBeGreaterThan(second!.rank);
    expect(second).toMatchObject({
      id: "iem-EAX-SV.W-2013-53",
      ends: "2013-05-20T20:45:00Z",
      hazards: { maxHail: "1.00", maxWind: "60 MPH" },
      url: "https://mesonet.agron.iastate.edu/api/1/nwstext/201305202000-KEAX-WUUS53-SVREAX",
    });
    expect(second!.geometry?.type).toBe("MultiPolygon");
  });
});
