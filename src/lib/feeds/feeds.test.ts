import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpError } from "../api/http";
import { localApi } from "../native/local-api";
import { alertsFeed } from "./alerts";
import { FEEDS } from "./index";
import { radarScansFeed } from "./radar";

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
