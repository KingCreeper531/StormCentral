/**
 * Client for a Pro data server (pro-server/ in this repo): products the
 * browser can't make itself, rendered on a schedule from NOAA's open data
 * (GOES RGB composites from raw ABI channels, MRMS hail size, rotation tracks
 * and VIL from GRIB2). The server publishes `index.json` plus one Web
 * Mercator PNG per frame.
 */
import type { LegendStop } from "../radar/products";
import type { RadarFrame } from "../radar/frames";

export interface ServerProduct {
  label: string;
  kind: "rgb" | "value";
  /** [west, south, east, north], degrees; images are linear in Web Mercator. */
  bounds: [number, number, number, number];
  frames: { time: string; url: string }[];
  legend?: { unit: string; decimals?: number; stops: LegendStop[] };
}

export interface ServerIndex {
  generated: string;
  products: Record<string, ServerProduct>;
}

/**
 * A usable base URL: https anywhere, plain http only for this machine (the
 * web app is served over https and browsers block http requests from it).
 * Returns "" for anything else.
 */
export function normalizeServerUrl(raw: string): string {
  const v = raw.trim().replace(/\/+$/, "").replace(/\/index\.json$/, "");
  if (!v) return "";
  try {
    const u = new URL(v);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return "";
    if (u.username || u.password) return "";
    return `${u.origin}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return "";
  }
}

export async function fetchServerIndex(base: string, signal?: AbortSignal): Promise<ServerIndex> {
  const res = await fetch(`${base}/index.json`, { signal, cache: "no-cache" });
  if (!res.ok) throw new Error(`Pro data server answered ${res.status}`);
  const data = (await res.json()) as ServerIndex;
  if (!data || typeof data !== "object" || typeof data.products !== "object") throw new Error("Pro data server index is malformed");
  return data;
}

/** MapLibre image corners from [west, south, east, north]. */
export function corners(b: readonly [number, number, number, number]): NonNullable<RadarFrame["image"]>["coordinates"] {
  const [w, s, e, n] = b;
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ];
}

/** Loop frames for one server product (newest `count`). */
export function serverFrames(base: string, id: string, p: ServerProduct, count: number): RadarFrame[] {
  return p.frames.slice(-count).flatMap((f) => {
    const time = Date.parse(f.time);
    if (!Number.isFinite(time) || typeof f.url !== "string" || /^[a-z]+:/i.test(f.url) || f.url.includes("..")) return [];
    const url = `${base}/${f.url.replace(/^\/+/, "")}`;
    return [{ id: `srv-${id}-${f.time}`, time, tileUrl: url, maxzoom: 0, image: { url, coordinates: corners(p.bounds) } }];
  });
}
