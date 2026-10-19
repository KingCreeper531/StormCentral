/**
 * Radar from other countries' national weather services, for the parts of
 * the world NEXRAD doesn't cover. Every source here was checked to serve
 * tiles to browsers (CORS) without a key:
 *  - Canada: ECCC GeoMet, the North American 1 km composite (precipitation rate);
 *  - Germany: DWD's precipitation radar composite;
 *  - Finland: FMI's reflectivity composite;
 *  - Netherlands: KNMI's precipitation radar;
 *  - Japan: JMA's high-resolution precipitation nowcast (observed frames only).
 * The WMS sources take a TIME parameter; JMA publishes XYZ tiles per time.
 */
import type { RadarFrame } from "./frames";

export const INTL_RADAR_IDS = ["eccc", "dwd", "fmi", "knmi", "jma"] as const;
export type IntlRadarId = (typeof INTL_RADAR_IDS)[number];

export interface IntlRadar {
  id: IntlRadarId;
  /** "Canada". */
  country: string;
  /** "Environment and Climate Change Canada". */
  agency: string;
  /** Short label for the legend: "ECCC". */
  short: string;
  /** Coverage [w, s, e, n]. */
  bounds: [number, number, number, number];
  /** Minutes between frames. */
  stepMin: number;
  /** How long after its time a frame is reliably available (grid-timed sources). */
  latencyMin: number;
  /** Where the times come from: the WMS capabilities, JMA's list, or the fixed grid. */
  times: "caps" | "jma" | "grid";
  maxzoom: number;
  minzoom?: number;
  tileSize: 256 | 512;
  /** What the colours mean. */
  measures: "reflectivity" | "precipitation rate";
  attribution: string;
  /** Tile URL template for one time (ISO). */
  tileUrl: (iso: string) => string;
  /** The capabilities document listing the times (caps sources). */
  capsUrl?: string;
}

function wms(base: string, layer: string, style: string, iso: string, size: number, extra = ""): string {
  const q = [
    "SERVICE=WMS",
    "VERSION=1.3.0",
    "REQUEST=GetMap",
    `LAYERS=${layer}`,
    `STYLES=${style}`,
    "CRS=EPSG:3857",
    "BBOX={bbox-epsg-3857}",
    `WIDTH=${size}`,
    `HEIGHT=${size}`,
    "FORMAT=image/png",
    "TRANSPARENT=TRUE",
    `TIME=${encodeURIComponent(iso)}`,
  ].join("&");
  return `${base}${base.includes("?") ? "&" : "?"}${q}${extra}`;
}

/** `20261019172500` (JMA's UTC stamp) ↔ ISO. */
export const jmaStamp = (iso: string) => iso.replace(/[-:T]/g, "").slice(0, 12) + "00";
export const fromJmaStamp = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00Z`;

export const INTL_RADARS: Record<IntlRadarId, IntlRadar> = {
  eccc: {
    id: "eccc",
    country: "Canada",
    agency: "Environment and Climate Change Canada",
    short: "ECCC",
    // The composite reaches into the US too; NOAA's radar is drawn over it there.
    bounds: [-141, 41.5, -52, 70],
    stepMin: 6,
    latencyMin: 8,
    times: "caps",
    maxzoom: 9,
    tileSize: 512,
    measures: "precipitation rate",
    attribution: "Radar: Environment and Climate Change Canada",
    tileUrl: (iso) => wms("https://geo.weather.gc.ca/geomet", "RADAR_1KM_RRAI", "", iso, 512),
    capsUrl: "https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_1KM_RRAI",
  },
  dwd: {
    id: "dwd",
    country: "Germany",
    agency: "Deutscher Wetterdienst",
    short: "DWD",
    bounds: [1.5, 45.5, 17, 56.5],
    stepMin: 5,
    latencyMin: 10,
    // DWD's capabilities take 10–20 s to build; its 5-minute grid is regular.
    times: "grid",
    maxzoom: 9,
    tileSize: 512,
    measures: "reflectivity",
    attribution: "Radar: Deutscher Wetterdienst",
    tileUrl: (iso) => wms("https://maps.dwd.de/geoserver/dwd/wms", "dwd:Niederschlagsradar", "", iso, 512),
  },
  fmi: {
    id: "fmi",
    country: "Finland",
    agency: "Finnish Meteorological Institute",
    short: "FMI",
    bounds: [10, 56.5, 37.5, 71.5],
    stepMin: 5,
    latencyMin: 10,
    times: "grid",
    maxzoom: 9,
    tileSize: 512,
    measures: "reflectivity",
    attribution: "Radar: Finnish Meteorological Institute",
    tileUrl: (iso) => wms("https://openwms.fmi.fi/geoserver/Radar/wms", "suomi_dbz_eureffin", "", iso, 512),
  },
  knmi: {
    id: "knmi",
    country: "Netherlands",
    agency: "Royal Netherlands Meteorological Institute",
    short: "KNMI",
    bounds: [0, 48.9, 10.9, 56],
    stepMin: 5,
    latencyMin: 8,
    times: "caps",
    maxzoom: 10,
    tileSize: 512,
    measures: "precipitation rate",
    attribution: "Radar: KNMI",
    tileUrl: (iso) => wms("https://geoservices.knmi.nl/adagucserver?dataset=RADAR", "RAD_NL25_PCP_CM", "radar/nearest", iso, 512),
    capsUrl: "https://geoservices.knmi.nl/adagucserver?dataset=RADAR&service=WMS&version=1.3.0&request=GetCapabilities",
  },
  jma: {
    id: "jma",
    country: "Japan",
    agency: "Japan Meteorological Agency",
    short: "JMA",
    bounds: [118, 20, 150, 48],
    stepMin: 5,
    latencyMin: 5,
    times: "jma",
    maxzoom: 10,
    minzoom: 4,
    tileSize: 256,
    measures: "precipitation rate",
    attribution: "Radar: Japan Meteorological Agency",
    tileUrl: (iso) => {
      const s = jmaStamp(iso);
      return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${s}/none/${s}/surf/hrpns/{z}/{x}/{y}.png`;
    },
  },
};

export const JMA_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";

export const isIntlRadarId = (v: unknown): v is IntlRadarId => typeof v === "string" && (INTL_RADAR_IDS as readonly string[]).includes(v);

/** Times on a source's fixed grid: `count` steps ending at the newest that should be published by `now`. */
export function gridTimes(r: Pick<IntlRadar, "stepMin" | "latencyMin">, now: number, minutes: number): string[] {
  const step = r.stepMin * 60_000;
  const newest = Math.floor((now - r.latencyMin * 60_000) / step) * step;
  const out: string[] = [];
  for (let t = newest - Math.floor((minutes * 60_000) / step) * step; t <= newest; t += step) out.push(new Date(t).toISOString().replace(".000Z", "Z"));
  return out;
}

/** Observed frames from JMA's time list (base time = valid time), oldest first. */
export function parseJmaTimes(list: readonly { basetime?: string; validtime?: string }[]): string[] {
  const out = new Set<string>();
  for (const t of list) if (t.basetime && t.basetime === t.validtime && /^\d{14}$/.test(t.basetime)) out.add(fromJmaStamp(t.basetime));
  return [...out].sort();
}

const intersects = (a: readonly number[], b: readonly number[]) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;

/** The sources whose coverage the view [w, s, e, n] touches. */
export function intlRadarsInView(view: readonly number[] | null): IntlRadar[] {
  if (!view) return [];
  return INTL_RADAR_IDS.map((id) => INTL_RADARS[id]).filter((r) => intersects(r.bounds, view));
}

export function intlFrame(r: IntlRadar, iso: string): RadarFrame {
  return {
    id: `intl-${r.id}-${iso}`,
    time: Date.parse(iso),
    tileUrl: r.tileUrl(iso),
    maxzoom: r.maxzoom,
    minzoom: r.minzoom,
    tileSize: r.tileSize,
    bounds: r.bounds,
    attribution: r.attribution,
  };
}

/**
 * Frames of a source matched to a loop's times (AWIPS-style time matching):
 * each loop time gets the source's latest time at or before it, within
 * `toleranceMin`, else nothing. `frames` holds each matched time once and
 * `index[i]` points loop frame i at one of them (or -1).
 */
export function matchFrames(r: IntlRadar, times: readonly string[], loop: readonly number[], toleranceMin = 12): { frames: RadarFrame[]; index: number[] } {
  const ms = times.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b);
  const frames: RadarFrame[] = [];
  const at = new Map<number, number>();
  const index = loop.map((t) => {
    // Latest source time not after the loop time (plus a minute of slack for clock skew).
    let lo = 0;
    let hi = ms.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ms[mid]! <= t + 60_000) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best < 0 || t - ms[best]! > toleranceMin * 60_000) return -1;
    const s = ms[best]!;
    let i = at.get(s);
    if (i == null) {
      i = frames.length;
      at.set(s, i);
      frames.push(intlFrame(r, new Date(s).toISOString().replace(".000Z", "Z")));
    }
    return i;
  });
  return { frames, index };
}
