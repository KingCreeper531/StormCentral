import { describe, expect, it, vi } from "vitest";
import { destination, haversineKm } from "../geo";
import { FAMILIES } from "../radar/products";
import { ibwDetails, ibwSection } from "./ibw";
import { modelPoint, parseProfile, PROFILE_LEVELS, transect, type OpenMeteoProfile } from "./model";
import { isProProductId, PRO_PRODUCT_IDS, PRO_PRODUCTS, productUsable, satelliteFrames, shownProduct } from "./products";
import { fillTileUrl, pixelAt, tileBbox, tileZoom, valueFromColor, wrapLon } from "./sample";
import { arrivals, minutesUntil, motionFrom, stormMotion, toaFan } from "./storm-tools";
import { frameAt, syncTime } from "./sync";

describe("sync clock", () => {
  it("shows each pane the newest frame at or before the clock", () => {
    const times = [100, 200, 300];
    expect(frameAt(times, 250)).toBe(1);
    expect(frameAt(times, 300)).toBe(2);
    expect(frameAt(times, 50)).toBe(0);
    expect(frameAt([], 50)).toBe(-1);
    expect(syncTime({ timeline: times, index: 5 })).toBe(300);
  });
});

describe("products", () => {
  it("validates ids", () => {
    expect(isProProductId("ref")).toBe(true);
    expect(isProProductId("nope")).toBe(false);
    for (const id of PRO_PRODUCT_IDS) expect(PRO_PRODUCTS[id].id).toBe(id);
  });

  it("pairs one satellite image with each 10-minute slot of the loop", () => {
    const base = Date.UTC(2026, 9, 19, 18, 0);
    const loop = [0, 4, 8, 12, 16, 20].map((m) => base + m * 60_000);
    const frames = satelliteFrames("sat-ir", "east", loop, 10, base);
    expect(frames.length).toBe(3);
    expect(frames.every((f) => f.tileUrl.includes("GOES-East_ABI_Band13_Clean_Infrared"))).toBe(true);
    // Each frame is stamped with the loop time it stands in for, so frameAt pairs it correctly.
    expect(frameAt(frames.map((f) => f.time), loop[5]!)).toBe(2);
    // RGB composites only exist for GOES-East.
    expect(satelliteFrames("sat-airmass", "west", loop, 10, base)[0]!.tileUrl).toContain("GOES-East_ABI_Air_Mass");
  });
});

describe("sampling", () => {
  it("finds the tile and pixel under a point", () => {
    const { tx, ty, px, py } = pixelAt(0, 0, 1, 256);
    expect([tx, ty, px, py]).toEqual([1, 1, 0, 0]);
    expect(tileBbox(0, 0, 0)).toBe("-20037508.342789244,-20037508.342789244,20037508.342789244,20037508.342789244");
    expect(fillTileUrl("a/{z}/{x}/{y}.png", 3, 2, 1)).toBe("a/3/2/1.png");
    expect(tileZoom(6.7, 256, 10)).toBe(7);
    expect(tileZoom(6.7, 512, 10)).toBe(6);
    expect(tileZoom(12, 256, 8)).toBe(8);
  });

  it("reads points on the world's copies from the one world", () => {
    expect(pixelAt(-215, 40, 3, 256)).toEqual(pixelAt(145, 40, 3, 256));
    expect(pixelAt(180, 0, 1, 256).tx).toBe(0);
    expect(wrapLon(-215)).toBeCloseTo(145, 9);
    expect(wrapLon(-97)).toBe(-97);
    // An image's own longitudes: wrapped to start at its west edge.
    expect(wrapLon(-170, 150)).toBeCloseTo(190, 9);
  });

  it("reads values back from scale colours, interpolating between stops", () => {
    const ref = FAMILIES.reflectivity.legend;
    expect(valueFromColor([0xfd, 0x00, 0x00], ref)!.value).toBeCloseTo(50, 0);
    // Halfway between the 20 and 25 dBZ greens.
    const mid = valueFromColor([2, 225, 2], ref)!;
    expect(mid.value).toBeGreaterThan(21);
    expect(mid.value).toBeLessThan(24);
    expect(valueFromColor([0x05, 0x8b, 0x05], FAMILIES.hc.legend, true)!.value).toBe(5);
  });
});

describe("storm tools", () => {
  const a = { lat: 35, lon: -98, t: 0 };
  const b = { ...destination(a, 60, 40 * 1.852 * 0.5), t: 30 * 60_000 }; // 40 kt toward 060° for 30 min

  it("measures storm motion from two picks", () => {
    const m = stormMotion(b, a)!;
    expect(m.speedKt).toBeCloseTo(40, 0);
    expect(m.headingDeg).toBeCloseTo(60, 0);
    expect(motionFrom(m)).toBeCloseTo(240, 0);
    expect(stormMotion(a, { ...a, t: 60_000 })).toBeNull();
  });

  it("builds a fan whose arcs are the right distance out", () => {
    const m = stormMotion(a, b)!;
    const fan = toaFan(m);
    expect(fan.arcs.map((x) => x.minutes)).toEqual([15, 30, 45, 60]);
    const [lon, lat] = fan.arcs[3]!.coords[8]!; // centre of the 60-minute arc
    expect(haversineKm(m.origin, { lat, lon })).toBeCloseTo(40 * 1.852, 0);
    expect(fan.ring[0]).toEqual(fan.ring.at(-1));
  });

  it("orders arrivals in the path first", () => {
    const m = stormMotion(a, b)!;
    const ahead = { ...destination(m.origin, 60, 37), name: "ahead" };
    const beside = { ...destination(m.origin, 150, 20), name: "beside" };
    const r = arrivals(m, [beside, ahead]);
    expect(r[0]!.name).toBe("ahead");
    expect(r[0]!.inPath).toBe(true);
    expect(r[0]!.minutes).toBeCloseTo(30, 0);
    expect(r[1]!.inPath).toBe(false);
  });

  it("counts arrivals from now, not from the pick", () => {
    const m = stormMotion(a, b)!;
    const [r] = arrivals(m, [{ ...destination(m.origin, 60, 37), name: "ahead" }]);
    // Picked on a frame 10 minutes ago: 20 minutes left.
    expect(minutesUntil(r!, m.origin.t + 10 * 60_000)).toBeCloseTo(20, 0);
    // 40 minutes on, it's passed.
    expect(minutesUntil(r!, m.origin.t + 40 * 60_000)).toBeLessThan(0);
  });
});

describe("IBW", () => {
  const description = `At 512 PM CDT, a severe thunderstorm capable of producing a tornado was located near Moore, moving northeast at 35 mph.

HAZARD...Tornado and two inch hail.

SOURCE...Radar indicated rotation.

IMPACT...Flying debris will be dangerous to those caught without
shelter. Mobile homes will be damaged or destroyed.

Locations impacted include...`;

  it("pulls the HAZARD / SOURCE / IMPACT paragraphs", () => {
    expect(ibwSection(description, "HAZARD")).toBe("Tornado and two inch hail.");
    expect(ibwSection(description, "IMPACT")).toBe("Flying debris will be dangerous to those caught without shelter. Mobile homes will be damaged or destroyed.");
  });

  it("maps tags to the damage-threat tier", () => {
    const base = { tags: [] as string[], hazards: { tornado: "RADAR INDICATED", maxHail: "2.00" }, description };
    expect(ibwDetails(base)).toMatchObject({ tier: "base", detection: "radar indicated", maxHail: "2.00", source: "Radar indicated rotation." });
    expect(ibwDetails({ ...base, tags: ["PDS"] }).tier).toBe("considerable");
    expect(ibwDetails({ ...base, tags: ["DESTRUCTIVE"] }).tier).toBe("destructive");
    expect(ibwDetails({ ...base, tags: ["TORNADO EMERGENCY", "OBSERVED"], hazards: { tornado: "OBSERVED" } })).toMatchObject({ tier: "catastrophic", detection: "observed" });
  });
});

describe("model profiles", () => {
  function fake(elevation: number, sfcP: number): OpenMeteoProfile {
    const hourly: OpenMeteoProfile["hourly"] = { time: ["2026-10-19T18:00"] };
    hourly.temperature_2m = [28];
    hourly.dew_point_2m = [20];
    hourly.surface_pressure = [sfcP];
    hourly.wind_speed_10m = [8];
    hourly.wind_direction_10m = [170];
    hourly.cape = [2500];
    hourly.convective_inhibition = [-40];
    for (const p of PROFILE_LEVELS) {
      const z = 44331 * (1 - (p / 1013.25) ** 0.1903);
      hourly[`temperature_${p}hPa`] = [28 - 6.5 * (z / 1000)];
      hourly[`dew_point_${p}hPa`] = [20 - 8 * (z / 1000)];
      hourly[`geopotential_height_${p}hPa`] = [z];
      hourly[`wind_speed_${p}hPa`] = [10 + z / 500];
      hourly[`wind_direction_${p}hPa`] = [200 + z / 200];
    }
    return { latitude: 35, longitude: -97, elevation, hourly };
  }

  it("starts at the surface and drops levels below ground", () => {
    const m = parseProfile(fake(1600, 840));
    const lv = m.sounding!.levels;
    expect(lv[0]!.p).toBe(840);
    expect(lv[0]!.z).toBe(1600);
    expect(lv[1]!.p).toBe(800);
    expect(lv.every((l, i) => i === 0 || (l.p < lv[i - 1]!.p && l.z > lv[i - 1]!.z))).toBe(true);
    expect(m.valid).toBe(Date.UTC(2026, 9, 19, 18));
    expect(m.sfc.cape).toBe(2500);
  });

  it("spaces transect points evenly", () => {
    const pts = transect({ lat: 30, lon: -100 }, { lat: 40, lon: -90 }, 11);
    expect(pts[5]).toEqual({ lat: 35, lon: -95 });
  });

  it("shares a point's request without one caller's abort failing the others", async () => {
    let answer = () => {};
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          answer = () => resolve(new Response(JSON.stringify(fake(370, 970))));
        }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const hover = new AbortController();
      const first = modelPoint({ lat: 12.34, lon: 56.78 }, hover.signal);
      const second = modelPoint({ lat: 12.34, lon: 56.78 }, new AbortController().signal);
      hover.abort();
      await expect(first).rejects.toMatchObject({ name: "AbortError" });
      answer();
      await expect(second).resolves.toMatchObject({ elevation: 370 });
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("value scales", () => {
  it("pins NOAA's ramps to their legend values", async () => {
    const { NOAA_ECHO_TOPS, NOAA_REFLECTIVITY, NOAA_VELOCITY, scaleForTiles } = await import("./scales");
    expect(NOAA_REFLECTIVITY.stops.length).toBe(100);
    expect(NOAA_ECHO_TOPS.stops.length).toBe(100);
    for (const s of [NOAA_REFLECTIVITY, NOAA_ECHO_TOPS, NOAA_VELOCITY]) {
      expect(s.stops.every((x, i) => i === 0 || x.value > s.stops[i - 1]!.value)).toBe(true);
    }
    // Yellow starts NOAA's 35–40 dBZ band; the first green near 20 dBZ.
    expect(valueFromColor([0xff, 0xe1, 0x01], NOAA_REFLECTIVITY.stops)!.value).toBeCloseTo(37.6, 0);
    expect(valueFromColor([0x0e, 0xd5, 0x14], NOAA_REFLECTIVITY.stops)!.value).toBeCloseTo(22.6, 0);
    expect(Math.abs(valueFromColor([0x03, 0xb3, 0x03], NOAA_VELOCITY.stops)!.value + 20)).toBeLessThan(1);
    expect(Math.abs(valueFromColor([0x8b, 0x00, 0x00], NOAA_VELOCITY.stops)!.value - 20)).toBeLessThan(1);
    expect(valueFromColor([0xf5, 0xf6, 0x3c], NOAA_ECHO_TOPS.stops)!.value).toBeCloseTo(47.3, 0);
    expect(scaleForTiles("https://opengeo.ncep.noaa.gov/geoserver/conus/ows?layers=conus_neet_v18", null)).toBe(NOAA_ECHO_TOPS);
    expect(scaleForTiles("https://opengeo.ncep.noaa.gov/geoserver/ktlx/ows?layers=ktlx_sr_bvel", "velocity")).toBe(NOAA_VELOCITY);
    expect(scaleForTiles("https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::TLX-N0C-202610191800/{z}/{x}/{y}.png", "cc")!.unit).toBe("ρhv");
    expect(scaleForTiles("https://gibs.earthdata.nasa.gov/wms", null)).toBeNull();
  });
});

describe("products this device can show", () => {
  it("hides Level II on phones and the data server's products until one is set up", () => {
    expect(productUsable("vol-ref", { volume: true })).toBe(true);
    expect(productUsable("vol-ref", { volume: false })).toBe(false);
    // No NEXT_PUBLIC_PRO_SERVER in tests.
    expect(PRO_PRODUCT_IDS.filter((id) => PRO_PRODUCTS[id].kind === "server").every((id) => !productUsable(id, { volume: true }))).toBe(true);
    expect(productUsable("cc", { volume: false })).toBe(true);
  });

  it("swaps a saved product that doesn't work here for the nearest one that does", () => {
    expect(shownProduct("vol-vel", { volume: false })).toBe("vel");
    expect(shownProduct("vol-vel", { volume: true })).toBe("vol-vel");
    expect(shownProduct("goes-nightmicro", { volume: true })).toBe("sat-ir");
    expect(shownProduct("mrms-mesh", { volume: true })).toBe("cref");
    for (const id of PRO_PRODUCT_IDS) expect(productUsable(shownProduct(id, { volume: false }), { volume: false })).toBe(true);
  });
});
