import { describe, expect, it } from "vitest";
import { viewMoved } from "@/hooks/use-nowcast";
import { translator } from "@/lib/i18n/core";
import { DEFAULT_RADAR, normalizeRadar, type RadarSettings } from "@/store/app-store";
import {
  advect,
  advectFrames,
  cleanMotion,
  echoIntensity,
  estimateMotion,
  fieldIsReliable,
  gridCorners,
  leadFade,
  meanMotion,
  motionField,
  motionPair,
  NOWCAST_LEADS,
  nowcastLabel,
  sampleMotion,
  tilesFor,
  tileUrl,
  tileZoom,
  uniformMotion,
  viewGrid,
  wmsUrl,
  type Motion,
} from "./nowcast";

const W = 160;
const H = 120;

/** A storm-like echo: a soft core with a ragged edge (texture for the matcher), centred at (cx, cy). */
function storm(cx: number, cy: number, w = W, h = H): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx * 1.3, dy);
      const edge = 18 + 4 * Math.sin(Math.atan2(dy, dx) * 5);
      if (r < edge) out[y * w + x] = 1 + 4 * (1 - r / edge) + ((x * 7 + y * 13) % 5) * 0.1;
    }
  return out;
}

/** An RGBA image with one opaque square of colour `rgb` at (x0, y0). */
function square(x0: number, y0: number, size: number, rgb: [number, number, number], w = 64, h = 64): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * w + x) * 4;
      px.set([...rgb, 255], i);
    }
  return px;
}

const alphaAt = (px: Uint8ClampedArray, x: number, y: number, w = 64) => px[(y * w + x) * 4 + 3]!;

describe("echoIntensity", () => {
  it("ranks radar colours from weak (blue) to strong (red, magenta), and nothing where it's transparent", () => {
    const colours: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [40, 80, 230, 255], // blue
      [20, 200, 40, 255], // green
      [240, 230, 30, 255], // yellow
      [230, 20, 20, 255], // red
      [220, 30, 220, 255], // magenta
    ];
    const v = echoIntensity(colours.flat(), colours.length, 1);
    expect(v[0]).toBe(0);
    for (let i = 2; i < v.length; i++) expect(v[i]!).toBeGreaterThan(v[i - 1]!);
  });
});

describe("motion", () => {
  it("recovers a storm's shift within a pixel", () => {
    const m = motionField(storm(70, 60), storm(75, 57), W, H);
    expect(m).not.toBeNull();
    const [u, v] = sampleMotion(m!, 75, 57);
    expect(Math.abs(u - 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(v + 3)).toBeLessThanOrEqual(1);
  });

  it("works on a coarsened grid and reports full-grid pixels", () => {
    const m = motionField(storm(70, 60), storm(78, 64), W, H, 2, { block: 12, search: 7 });
    const mean = meanMotion(m!);
    expect(Math.abs(mean.u - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(mean.v - 4)).toBeLessThanOrEqual(1);
  });

  it("finds no motion where there are no echoes to track", () => {
    expect(motionField(new Float32Array(W * H), new Float32Array(W * H), W, H)).toBeNull();
    const m = estimateMotion(new Float32Array(W * H), storm(70, 60), W, H);
    // Blocks of the newer scan with nothing to match in the older one aren't trusted.
    expect(m.valid.some((x) => x === 1)).toBe(false);
  });
});

describe("cleanMotion", () => {
  const field = (vectors: ([number, number] | null)[], cols: number): Motion => {
    const rows = vectors.length / cols;
    const m = uniformMotion({ cols, rows, block: 10, ox: 0, oy: 0 }, 0, 0);
    vectors.forEach((vec, i) => {
      m.valid[i] = vec ? 1 : 0;
      m.u[i] = vec?.[0] ?? 0;
      m.v[i] = vec?.[1] ?? 0;
    });
    return m;
  };

  it("fills blocks without echoes from their neighbours", () => {
    const m = cleanMotion(field([[2, 1], [2, 1], null, [2, 1], null, null, [2, 1], [2, 1], null], 3));
    for (let i = 0; i < 9; i++) {
      expect(m.u[i]).toBeCloseTo(2);
      expect(m.v[i]).toBeCloseTo(1);
    }
  });

  it("replaces an outlier with the median around it", () => {
    const m = cleanMotion(field([[2, 1], [2, 1], [2, 1], [2, 1], [20, -15], [2, 1], [2, 1], [2, 1], [2, 1]], 3));
    expect(m.u[4]).toBeCloseTo(2);
    expect(m.v[4]).toBeCloseTo(1);
  });

  it("calls a field that disagrees with itself unreliable", () => {
    expect(fieldIsReliable(field([[2, 1], [2, 1], [2.5, 1], [2, 0.5]], 2))).toBe(true);
    expect(fieldIsReliable(field([[10, 0], [-10, 0], [0, 10], [0, -10]], 2))).toBe(false);
    expect(fieldIsReliable(field([[2, 1], null, null, null], 2))).toBe(false);
  });
});

describe("advect", () => {
  it("moves echoes along the motion, keeping their colour and fading them", () => {
    const img = square(10, 10, 6, [230, 20, 20]);
    const m = uniformMotion({ cols: 4, rows: 4, block: 16, ox: 0, oy: 0 }, 4, 2);
    // Three 10-minute steps of a motion measured over 10 minutes: 12 px right, 6 down.
    const out = advect(img, 64, 64, m, 3, 1, leadFade(30));
    expect(alphaAt(out, 10, 10)).toBe(0);
    expect(alphaAt(out, 22, 16)).toBe(Math.round(255 * leadFade(30)));
    expect(alphaAt(out, 27, 21)).toBeGreaterThan(0);
    expect(alphaAt(out, 28, 22)).toBe(0);
    expect([...out.slice((16 * 64 + 22) * 4, (16 * 64 + 22) * 4 + 3)]).toEqual([230, 20, 20]);
  });

  it("scales the step to the gap between the scans", () => {
    const img = square(10, 10, 6, [20, 200, 40]);
    // Motion of 6 px over a 15-minute gap: a 10-minute step moves 4 px.
    const out = advect(img, 64, 64, uniformMotion({ cols: 1, rows: 1, block: 64, ox: 0, oy: 0 }, 6, 0), 1, 10 / 15);
    expect(alphaAt(out, 14, 12)).toBe(255);
    expect(alphaAt(out, 13, 12)).toBe(0);
  });

  it("makes every frame at once the same as one at a time", () => {
    const img = square(20, 30, 8, [240, 230, 30]);
    const m = uniformMotion({ cols: 4, rows: 4, block: 16, ox: 0, oy: 0 }, 3, -2);
    const frames = [...advectFrames(img, 64, 64, m, 4, 0.5, (s) => leadFade(s * 10))];
    expect(frames).toHaveLength(4);
    frames.forEach((f, i) => expect([...f]).toEqual([...advect(img, 64, 64, m, i + 1, 0.5, leadFade((i + 1) * 10))]));
  });

  it("fades a little more each step out to an hour", () => {
    expect(NOWCAST_LEADS).toEqual([10, 20, 30, 40, 50, 60]);
    expect(leadFade(10)).toBeGreaterThan(leadFade(60));
    expect(leadFade(60)).toBeGreaterThanOrEqual(0.6);
  });
});

describe("motionPair", () => {
  const at = (min: number) => ({ id: `f${min}`, time: min * 60_000 });

  it("pairs the newest scan with the one closest to 15 minutes before it", () => {
    expect(motionPair([at(0), at(5), at(10), at(15), at(20)])!.map((f) => f.id)).toEqual(["f5", "f20"]);
  });

  it("falls back to the scan just before when none is far enough back", () => {
    expect(motionPair([at(0), at(2), at(3)])).toBeNull();
    expect(motionPair([at(0), at(3)])!.map((f) => f.id)).toEqual(["f0", "f3"]);
    expect(motionPair([at(0)])).toBeNull();
  });
});

describe("grid", () => {
  it("covers the view plus a margin, at most 768 px on the long side", () => {
    const g = viewGrid([-100, 30, -90, 40]);
    expect(Math.max(g.width, g.height)).toBe(768);
    const [[w, n], , [e, s]] = gridCorners(g);
    expect(w).toBeLessThan(-100);
    expect(e).toBeGreaterThan(-90);
    expect(s).toBeLessThan(30);
    expect(n).toBeGreaterThan(40);
  });

  it("picks a tile zoom fine enough for the grid, within the source's range and a tile budget", () => {
    const g = viewGrid([-100, 30, -90, 40], 512);
    const z = tileZoom(g, 0, 8);
    expect(z).toBeGreaterThanOrEqual(5);
    expect(z).toBeLessThanOrEqual(8);
    const cover = tilesFor(g, z);
    expect(cover.tiles.length).toBeLessThanOrEqual(24);
    // The first tile starts at or before the grid's top-left corner.
    expect(cover.tiles[0]!.px).toBeLessThanOrEqual(0);
    expect(cover.tiles[0]!.py).toBeLessThanOrEqual(0);
    expect(tileZoom(g, 0, 3)).toBe(3);
  });

  it("fills tile and WMS templates", () => {
    expect(tileUrl("https://x/{z}/{x}/{y}.png", { z: 5, x: 7, y: 12 })).toBe("https://x/5/7/12.png");
    const g = { west: -1, south: -2, east: 3, north: 4, width: 300, height: 200 };
    expect(wmsUrl("https://n/ows?width=512&height=512&bbox={bbox-epsg-3857}", g)).toBe("https://n/ows?width=300&height=200&bbox=-1.0,-2.0,3.0,4.0");
  });
});

describe("view tracking", () => {
  const v = (bounds: [number, number, number, number], zoom: number) => ({ bounds, zoom });

  it("extrapolates again only after a real move", () => {
    const base = v([-100, 30, -90, 40], 5);
    expect(viewMoved(null, base)).toBe(true);
    expect(viewMoved(base, v([-99.5, 30.2, -89.5, 40.2], 5.2))).toBe(false);
    expect(viewMoved(base, v([-97, 30, -87, 40], 5))).toBe(true);
    expect(viewMoved(base, v([-100, 30, -90, 40], 6))).toBe(true);
  });
});

describe("labels and settings", () => {
  it("labels future frames by lead time", () => {
    expect(nowcastLabel(30, translator("en"))).toBe("+30 min · Future");
    expect(nowcastLabel(30, translator("es"))).toBe("+30 min · Futuro");
  });

  it("turns future radar on for settings saved before it existed, and keeps it off once turned off", () => {
    const old: Partial<RadarSettings> = { ...DEFAULT_RADAR };
    delete old.nowcast;
    expect(normalizeRadar(old as RadarSettings).nowcast).toBe(true);
    expect(normalizeRadar({ ...DEFAULT_RADAR, nowcast: false }).nowcast).toBe(false);
  });
});
