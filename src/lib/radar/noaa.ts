/**
 * Radar straight from NOAA: the NWS GeoServer behind radar.weather.gov
 * (opengeo.ncep.noaa.gov). Two sources, the same ones dedicated radar apps
 * build on:
 *  - MRMS (Multi-Radar Multi-Sensor) quality-controlled base reflectivity
 *    mosaic for the national view, refreshed about every 2 minutes;
 *  - each NEXRAD site's super-resolution base reflectivity and velocity
 *    (0.5° beam, 250 m gates), refreshed with every volume scan (4–6 min).
 * Served as WMS with a time dimension; anything NOAA doesn't carry (higher
 * tilts, dual-pol, storm-relative velocity) stays on the IEM tiles.
 */
import type { RadarFrame } from "./frames";

export const NOAA_GEOSERVER = "https://opengeo.ncep.noaa.gov/geoserver";
export const NOAA_ATTRIBUTION = "Radar: NOAA/NWS (MRMS, NEXRAD)";

export interface NoaaLayer {
  workspace: string;
  layer: string;
  /** Short label for the legend: "MRMS" or "KTLX SR". */
  label: string;
  maxzoom: number;
}

const REFLECTIVITY = new Set(["N0B", "N0Q", "N0R", "NXB", "NXQ"]);
const VELOCITY = new Set(["N0G", "N0U", "N0V", "NXG", "NXU"]);

/** The NOAA layer for a radar view, or null when only IEM has it. */
export function noaaLayerFor(site: string | null, product: string): NoaaLayer | null {
  if (site === null) return { workspace: "conus", layer: "conus_bref_qcd", label: "MRMS", maxzoom: 10 };
  const icao = site.toLowerCase();
  // NEXRAD WSR-88D sites only (K***, P***, T*** TDWRs aren't on the server).
  if (!/^[kp][a-z]{3}$/.test(icao)) return null;
  const p = product.toUpperCase();
  if (REFLECTIVITY.has(p)) return { workspace: icao, layer: `${icao}_sr_bref`, label: `${site.toUpperCase()} SR`, maxzoom: 12 };
  if (VELOCITY.has(p)) return { workspace: icao, layer: `${icao}_sr_bvel`, label: `${site.toUpperCase()} SR`, maxzoom: 12 };
  return null;
}

/** WMS GetMap template for MapLibre; `{bbox-epsg-3857}` is filled per tile. */
export function noaaTileUrl(l: Pick<NoaaLayer, "workspace" | "layer">, time: string): string {
  const q = [
    "service=WMS",
    "version=1.3.0",
    "request=GetMap",
    `layers=${l.layer}`,
    "styles=",
    "format=image/png",
    "transparent=true",
    "crs=EPSG:3857",
    "width=256",
    "height=256",
    "bbox={bbox-epsg-3857}",
    `time=${encodeURIComponent(time)}`,
  ].join("&");
  return `${NOAA_GEOSERVER}/${l.workspace}/ows?${q}`;
}

export const noaaCapabilitiesUrl = (l: Pick<NoaaLayer, "workspace" | "layer">) =>
  `${NOAA_GEOSERVER}/${l.workspace}/${l.layer}/ows?service=WMS&version=1.3.0&request=GetCapabilities`;

const PERIOD = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

/**
 * Times from a WMS capabilities document's time dimension, oldest first.
 * GeoServer writes either a list ("t1,t2,…") or intervals ("start/end/PT2M").
 */
export function parseTimeDimension(xml: string, maxTimes = 400): string[] {
  const m = xml.match(/<Dimension[^>]*name="time"[^>]*>([^<]*)<\/Dimension>/i) ?? xml.match(/<Extent[^>]*name="time"[^>]*>([^<]*)<\/Extent>/i);
  if (!m) return [];
  const out = new Set<number>();
  for (const part of m[1]!.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, b, period] = part.split("/");
    const start = Date.parse(a!);
    if (!Number.isFinite(start)) continue;
    if (!b || !period) {
      out.add(start);
      continue;
    }
    const end = Date.parse(b);
    const pm = period.match(PERIOD);
    const step = pm ? ((Number(pm[1] ?? 0) * 60 + Number(pm[2] ?? 0)) * 60 + Number(pm[3] ?? 0)) * 1000 : 0;
    if (!Number.isFinite(end) || step <= 0) {
      out.add(start);
      continue;
    }
    // Only the newest steps of a long interval matter.
    for (let t = Math.max(start, end - step * maxTimes); t <= end; t += step) out.add(t);
  }
  return [...out]
    .sort((x, y) => x - y)
    .slice(-maxTimes)
    .map((t) => new Date(t).toISOString());
}

/**
 * Loop frames from NOAA times: `count` frames spread evenly over `spanMs`
 * ending on the newest (MRMS updates every 2 minutes, more often than a loop
 * needs).
 */
export function noaaFrames(l: NoaaLayer, times: readonly string[], count: number, spanMs: number): RadarFrame[] {
  const parsed = times.map((t) => ({ iso: t, ms: Date.parse(t) })).filter((t) => Number.isFinite(t.ms));
  if (!parsed.length) return [];
  const newest = parsed[parsed.length - 1]!.ms;
  const inSpan = parsed.filter((t) => t.ms >= newest - spanMs);
  const picked =
    inSpan.length <= count ? inSpan : Array.from({ length: count }, (_, i) => inSpan[Math.round((i * (inSpan.length - 1)) / (count - 1))]!);
  return picked.map((t) => ({
    id: `noaa-${l.layer}-${t.iso}`,
    time: t.ms,
    tileUrl: noaaTileUrl(l, t.iso),
    maxzoom: l.maxzoom,
    attribution: NOAA_ATTRIBUTION,
  }));
}

/**
 * Browser only: whether this device can load NOAA's tiles (MapLibre fetches
 * tiles, so the server must allow cross-origin requests). Checked once per
 * session with one tiny GetMap; IEM tiles are used when it fails.
 */
let usable: Promise<boolean> | null = null;
export function noaaTilesUsable(): Promise<boolean> {
  usable ??= (async () => {
    try {
      const url = noaaTileUrl({ workspace: "conus", layer: "conus_bref_qcd" }, "current")
        .replace("time=current", "")
        .replace("width=256", "width=8")
        .replace("height=256", "height=8")
        .replace("{bbox-epsg-3857}", "-10900000,4100000,-10800000,4200000");
      const res = await fetch(url, { mode: "cors", credentials: "omit", signal: AbortSignal.timeout(8000) });
      return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
    } catch {
      return false;
    }
  })();
  return usable;
}
