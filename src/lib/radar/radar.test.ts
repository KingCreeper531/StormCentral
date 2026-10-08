import { describe, expect, it } from "vitest";
import { compactUtc, framesFromScans, frameBudget, iemSiteId, mosaicOffsetFrames, MOSAIC_SITE } from "./frames";
import { RadarLayerManager, type RadarMap } from "./layer-manager";
import { crossfadeFor, frameDelayMs, nextPlayableIndex, stepIndex } from "./playback";
import { familiesAvailable, resolveTilts } from "./products";
import { getSite, nearestSites } from "./site-utils";

describe("frames", () => {
  it("formats compact UTC stamps and IEM ids", () => {
    expect(compactUtc(new Date("2026-10-07T04:05:59Z"))).toBe("202610070405");
    expect(iemSiteId("KLOT")).toBe("LOT");
    expect(iemSiteId("tjua")).toBe("JUA");
    expect(iemSiteId("USCOMP")).toBe("USCOMP");
  });

  it("dedupes, sorts and trims scans", () => {
    const f = framesFromScans(
      ["2026-10-07T14:10Z", "2026-10-07T14:00Z", "2026-10-07T14:05Z", "2026-10-07T14:05Z", "garbage"],
      "LOT",
      "N0B",
      2,
    );
    expect(f.map((x) => x.id)).toEqual(["LOT-N0B-202610071405", "LOT-N0B-202610071410"]);
    expect(f[1]!.tileUrl).toBe(
      "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::LOT-N0B-202610071410/{z}/{x}/{y}.png",
    );
    expect(f[0]!.maxzoom).toBe(10);
    expect(framesFromScans(["2026-10-07T14:10Z"], MOSAIC_SITE, "N0Q", 5)[0]!.maxzoom).toBe(8);
  });

  it("builds offset mosaic frames oldest → newest", () => {
    const f = mosaicOffsetFrames(new Date("2026-10-07T14:23:00Z"), 3);
    expect(f.map((x) => x.tileUrl.split("/").at(-4))).toEqual([
      "nexrad-n0q-900913-m10m",
      "nexrad-n0q-900913-m05m",
      "nexrad-n0q-900913",
    ]);
    expect(f[2]!.time).toBe(Date.parse("2026-10-07T14:15:00Z"));
  });

  it("scales the frame budget with device memory", () => {
    expect(frameBudget(2)).toBe(8);
    expect(frameBudget(8)).toBe(20);
    expect(frameBudget(undefined)).toBe(15);
  });
});

describe("products", () => {
  it("prefers super-res letters and only offers available tilts", () => {
    const avail = new Set(["N0B", "N0Q", "N1B", "N0G", "N0U", "NAU", "N0C"]);
    expect(resolveTilts("reflectivity", avail).map((t) => t.code)).toEqual(["N0B", "N1B"]);
    expect(resolveTilts("velocity", avail).map((t) => t.code)).toEqual(["N0G", "NAU"]);
    expect(familiesAvailable(avail)).toEqual(["reflectivity", "velocity", "cc"]);
    expect(resolveTilts("srv", null).map((t) => t.code)).toEqual(["N0S", "N1S", "N2S", "N3S"]);
  });
});

describe("sites", () => {
  it("finds the nearest WSR-88D", () => {
    expect(nearestSites({ lat: 35.22, lon: -97.44 })[0]!.icao).toBe("KTLX");
    expect(getSite("klot")?.place).toMatch(/Chicago/);
  });
});

describe("playback", () => {
  it("advances to the next buffered frame and waits otherwise", () => {
    expect(nextPlayableIndex(0, [true, true, true])).toBe(1);
    expect(nextPlayableIndex(2, [true, true, true])).toBe(0);
    expect(nextPlayableIndex(0, [true, false, true])).toBe(2);
    expect(nextPlayableIndex(1, [false, true, false])).toBe(1);
    expect(stepIndex(0, -1, 5)).toBe(4);
  });

  it("dwells on the newest frame and caps crossfades", () => {
    expect(frameDelayMs(4, 5, 1)).toBeGreaterThan(frameDelayMs(3, 5, 1) * 3);
    expect(crossfadeFor(4, true)).toBeLessThan(BASE_GUARD);
    expect(crossfadeFor(1, false)).toBe(0);
  });
});
const BASE_GUARD = 113;

function mockMap() {
  const sources = new Map<string, unknown>();
  const layers: { id: string; paint: Record<string, unknown> }[] = [];
  const loaded = new Set<string>();
  const handlers = new Map<string, Set<(e: unknown) => void>>();
  const map: RadarMap & { layers: typeof layers; loaded: Set<string>; emit: (t: string) => void } = {
    layers,
    loaded,
    addSource: (id, s) => sources.set(id, s),
    removeSource: (id) => sources.delete(id),
    getSource: (id) => sources.get(id),
    addLayer: (l) => layers.push({ id: l.id, paint: { ...l.paint } }),
    removeLayer: (id) => layers.splice(layers.findIndex((l) => l.id === id), 1),
    getLayer: (id) => layers.find((l) => l.id === id),
    setPaintProperty: (id, k, v) => {
      const l = layers.find((x) => x.id === id);
      if (l) l.paint[k] = v;
    },
    isSourceLoaded: (id) => loaded.has(id),
    on: (t, fn) => handlers.set(t, (handlers.get(t) ?? new Set()).add(fn)),
    off: (t, fn) => handlers.get(t)?.delete(fn),
    emit: (t) => handlers.get(t)?.forEach((fn) => fn({})),
  };
  return map;
}

describe("RadarLayerManager", () => {
  const frame = (m: number) => ({
    id: `LOT-N0B-2026100714${String(m).padStart(2, "0")}`,
    time: m,
    tileUrl: `https://x/${m}/{z}/{x}/{y}.png`,
    maxzoom: 10,
  });

  it("adds newest first, evicts dropped frames and flips opacity", () => {
    const map = mockMap();
    const statuses: number[] = [];
    const mgr = new RadarLayerManager(map, { schedule: (fn) => fn(), onStatus: (s) => statuses.push(s.loaded) });
    mgr.sync([frame(0), frame(5), frame(10)]);
    expect(map.layers.map((l) => l.id.slice(-2))).toEqual(["10", "05", "00"]);
    expect(map.layers.every((l) => l.paint["raster-opacity"] === 0)).toBe(true);

    mgr.show(2);
    mgr.show(1);
    const op = (suffix: string) => map.layers.find((l) => l.id.endsWith(suffix))!.paint["raster-opacity"];
    expect(op("05")).toBe(0.85);
    expect(op("10")).toBe(0);

    mgr.sync([frame(5), frame(10), frame(15)]);
    expect(map.layers.some((l) => l.id.endsWith("00"))).toBe(false);
    expect(map.layers).toHaveLength(3);

    map.loaded.add(`radar-src-${frame(15).id}`);
    map.emit("sourcedata");
    expect(mgr.isReady(2)).toBe(true);
    expect(statuses.at(-1)).toBe(1);

    mgr.setCrisp(true);
    expect(map.layers.every((l) => l.paint["raster-resampling"] === "nearest")).toBe(true);

    mgr.destroy();
    expect(map.layers).toHaveLength(0);
  });
});
