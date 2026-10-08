/**
 * Pure parsers for National Hurricane Center data (no I/O; unit-tested with
 * fixtures). Like the other feed parsers they are deliberately tolerant: NHC
 * and its ArcGIS service rename attributes with little notice, and a storm
 * without a cone beats no storm at all.
 */
import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson";
import type { TropicalForecastPoint, TropicalStorm } from "./tropical";

// ─── Small coercions ───────────────────────────────────────────────────────

type Props = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/** Case-insensitive attribute lookup: the first of `keys` that has a value. */
function attr(p: Props, ...keys: string[]): unknown {
  for (const k of keys) {
    for (const [key, v] of Object.entries(p)) if (key.toLowerCase() === k && v != null && v !== "") return v;
  }
  return undefined;
}

function isoTime(v: unknown): string | null {
  if (typeof v === "number" && v > 1e11) return new Date(v).toISOString(); // ArcGIS date fields are epoch ms
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return null;
  const iso = s.replace(" ", "T");
  const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

// ─── Intensity ─────────────────────────────────────────────────────────────

/** Saffir-Simpson hurricane wind scale category from 1-min sustained wind (kt). */
export function saffirSimpson(windKt: number | null): number | null {
  if (windKt == null || windKt < 64) return null;
  return windKt >= 137 ? 5 : windKt >= 113 ? 4 : windKt >= 96 ? 3 : windKt >= 83 ? 2 : 1;
}

/** Normalised development stage. */
export type StageKey = "HU" | "TS" | "TD" | "SS" | "SD" | "PT" | "LO" | "PC" | "DB";

const STAGE_CODES: Record<string, StageKey> = {
  HU: "HU", H: "HU", M: "HU", MH: "HU", TY: "HU", STY: "HU",
  TS: "TS", S: "TS",
  TD: "TD", D: "TD",
  STS: "SS", SS: "SS",
  STD: "SD", SD: "SD",
  PTC: "PT", PT: "PT", EX: "PT", ET: "PT", X: "PT",
  LO: "LO", L: "LO", RL: "LO",
  PC: "PC",
  DB: "DB", WV: "DB",
};

/**
 * Development stage from an NHC classification code ("HU", "PTC"), a
 * shapefile development label ("M", "S", "D") or a description
 * ("Post-Tropical Cyclone").
 */
export function stageOf(raw: unknown): StageKey | null {
  const s = str(raw)?.toUpperCase();
  if (!s) return null;
  if (STAGE_CODES[s]) return STAGE_CODES[s];
  if (/POST|EXTRA/.test(s)) return "PT";
  if (/SUB\s*-?TROP/.test(s)) return /STORM/.test(s) ? "SS" : "SD";
  if (/POTENTIAL/.test(s)) return "PC";
  if (/HURRICANE|TYPHOON/.test(s)) return "HU";
  if (/STORM/.test(s)) return "TS";
  if (/DEPRESSION/.test(s)) return "TD";
  if (/REMNANT|\bLOW\b/.test(s)) return "LO";
  if (/DISTURB|WAVE/.test(s)) return "DB";
  return null;
}

/**
 * Short intensity label: "H1"–"H5" for hurricanes, otherwise the stage code
 * ("TS", "TD", "SS", "SD", "PT", "LO", "PC", "DB"). Without a stage, it
 * comes from the wind alone.
 */
export function intensityLabel(stage: StageKey | null, windKt: number | null, ssnum: number | null = null): string | null {
  if (stage === "HU") {
    const cat = saffirSimpson(windKt) ?? (ssnum != null && ssnum >= 1 && ssnum <= 5 ? Math.round(ssnum) : 1);
    return `H${cat}`;
  }
  if (stage) return stage;
  if (ssnum != null && ssnum >= 1 && ssnum <= 5) return `H${Math.round(ssnum)}`;
  if (windKt == null) return null;
  return windKt >= 64 ? `H${saffirSimpson(windKt)}` : windKt >= 34 ? "TS" : "TD";
}

/** Title prefix by NHC classification code ("Hurricane Milton"). */
const TITLE: Record<string, string> = {
  HU: "Hurricane",
  TY: "Typhoon",
  STY: "Super Typhoon",
  TS: "Tropical Storm",
  TD: "Tropical Depression",
  STS: "Subtropical Storm",
  SS: "Subtropical Storm",
  STD: "Subtropical Depression",
  SD: "Subtropical Depression",
  PTC: "Post-Tropical Cyclone",
  PC: "Potential Tropical Cyclone",
};

const BASINS: Record<string, string> = { AT: "Atlantic", AL: "Atlantic", EP: "Eastern Pacific", CP: "Central Pacific" };

// ─── Coordinates ───────────────────────────────────────────────────────────

/**
 * Latitude/longitude from NHC's numeric field, with the hemisphere letter of
 * the text field ("25.4N", "80.1W") deciding the sign when present.
 */
export function parseCoordinate(numeric: unknown, text: unknown, axis: "lat" | "lon"): number | null {
  const t = str(text)?.toUpperCase();
  const m = t?.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/);
  const fromText = m ? Number(m[1]) * (m[2] === "S" || m[2] === "W" ? -1 : 1) : null;
  let v = num(numeric);
  if (v == null) v = fromText;
  else if (m?.[2] && fromText != null && Math.sign(v) !== Math.sign(fromText) && Math.abs(Math.abs(v) - Math.abs(fromText)) < 0.5) v = fromText;
  if (v == null || !Number.isFinite(v)) return null;
  return Math.abs(v) <= (axis === "lat" ? 90 : 360) ? v : null;
}

// ─── CurrentStorms.json ────────────────────────────────────────────────────

/** Storm number from an NHC id ("al142024" → 14). */
export const stormNumber = (id: string) => Number(id.match(/^[a-z]{2}(\d{2})\d{4}$/i)?.[1] ?? NaN);

function safeUrl(v: unknown): string | null {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s.replace(/^http:\/\/(www\.)?nhc\.noaa\.gov/i, "https://www.nhc.noaa.gov") : null;
}

/**
 * Parses `https://www.nhc.noaa.gov/CurrentStorms.json`. Returns `null` when
 * the document isn't recognisable, so a format change never reads as "no
 * active storms". Storms come back without geometry.
 */
export function parseCurrentStorms(raw: unknown): TropicalStorm[] | null {
  const list = (raw as { activeStorms?: unknown } | null)?.activeStorms;
  if (!Array.isArray(list)) return null;
  const out: TropicalStorm[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const s = item as Props;
    const id = str(s.id)?.toLowerCase();
    const lat = parseCoordinate(s.latitudeNumeric, s.latitude, "lat");
    const lon = parseCoordinate(s.longitudeNumeric, s.longitude, "lon");
    if (!id || lat == null || lon == null) continue;

    const classification = (str(s.classification) ?? "").toUpperCase();
    const rawName = str(s.name) ?? id.toUpperCase();
    const name = rawName === rawName.toUpperCase() ? titleCase(rawName) : rawName;
    const wind = num(s.intensity);
    const windKt = wind != null && wind >= 0 && wind < 250 ? wind : null;
    const pressure = num(s.pressure);
    const stage = stageOf(classification);
    const dir = num(s.movementDir);
    const speed = num(s.movementSpeed);
    const binRaw = str(s.binNumber)?.toUpperCase() ?? null;
    const bin = binRaw && /^(AT|EP|CP)\d$/.test(binRaw) ? binRaw : null;
    const pub = (s.publicAdvisory && typeof s.publicAdvisory === "object" ? s.publicAdvisory : {}) as Props;
    const issued = isoTime(pub.issuance);
    const advisoryUrl =
      safeUrl(pub.url) ??
      safeUrl((s.forecastAdvisory as Props | undefined)?.url) ??
      safeUrl((s.forecastGraphics as Props | undefined)?.url) ??
      (bin && !bin.startsWith("CP") ? `https://www.nhc.noaa.gov/text/MIATCP${bin}.shtml` : null);

    out.push({
      id,
      name,
      classification,
      title: `${TITLE[classification] ?? "Tropical Cyclone"} ${name}`,
      category: stage === "HU" ? (saffirSimpson(windKt) ?? (windKt != null ? 1 : null)) : null,
      windKt,
      pressureMb: pressure != null && pressure > 850 && pressure < 1100 ? pressure : null,
      lat,
      lon,
      movement: {
        towardDeg: dir != null && dir >= 0 && dir <= 360 ? dir % 360 : null,
        speedMph: speed != null && speed >= 0 && speed < 200 ? speed : null,
      },
      advisoryUrl,
      updated: isoTime(s.lastUpdate) ?? issued,
      cone: null,
      track: null,
      forecast: [],
      pastTrack: null,
      label: intensityLabel(stage, windKt),
      bin,
      basin: BASINS[(bin ?? id).slice(0, 2).toUpperCase()] ?? null,
      advisory: { number: str(pub.advNum), issued },
    });
  }
  return out;
}

// ─── ArcGIS MapServer layer discovery ──────────────────────────────────────

export type TropicalLayerKind = "cone" | "forecastTrack" | "forecastPoints" | "pastTrack" | "pastPoints" | "watchWarning";

/** Layer ids per storm bin, e.g. `{ AT1: { cone: 8, forecastTrack: 7, … } }`. */
export type TropicalLayerMap = Record<string, Partial<Record<TropicalLayerKind, number>>>;

const KINDS: [TropicalLayerKind, RegExp][] = [
  ["cone", /\bcone\b/],
  ["watchWarning", /watch|warning/],
  ["forecastPoints", /forecast\s*(points?|positions?)\b/],
  ["forecastTrack", /forecast\s*(track|line)\b/],
  ["pastPoints", /(past|observed|best)\s*(track\s*)?(points?|positions?)\b/],
  ["pastTrack", /(past|observed|best)\s*track\b/],
];

/**
 * Maps the MapServer's `layers` (`?f=json`) to per-bin layer ids by name
 * ("AT1 Forecast Cone"). A leaf layer without a bin in its own name inherits
 * one from its group layer ("AT1" › "Forecast Cone"). Ids are never assumed.
 */
export function parseLayerMap(raw: unknown): TropicalLayerMap {
  const layers = (raw as { layers?: unknown } | null)?.layers;
  const out: TropicalLayerMap = {};
  if (!Array.isArray(layers)) return out;
  const byId = new Map<number, { name: string; parent: number | null }>();
  for (const l of layers as Props[]) {
    const id = num(l?.id);
    const name = str(l?.name);
    if (id == null || !name) continue;
    const parent = num(l.parentLayerId);
    byId.set(id, { name, parent: parent != null && parent >= 0 ? parent : null });
  }
  for (const [id, { name, parent }] of byId) {
    // Full path, e.g. "AT1 Forecast Cone" or "Atlantic › AT1 › Forecast Cone".
    const path = [name];
    for (let p = parent, guard = 0; p != null && guard < 5; guard++) {
      const node = byId.get(p);
      if (!node) break;
      path.unshift(node.name);
      p = node.parent;
    }
    const full = path.join(" ").replace(/[_\s]+/g, " ");
    const bin = full.match(/\b(AT|EP|CP)\s?([1-5])\b/i);
    if (!bin) continue;
    const label = name.toLowerCase().replace(/[_\s]+/g, " ");
    const kind = KINDS.find(([, re]) => re.test(label))?.[0];
    if (!kind) continue;
    const key = `${bin[1]!.toUpperCase()}${bin[2]}`;
    const slot = (out[key] ??= {});
    if (slot[kind] == null) slot[kind] = id;
  }
  return out;
}

// ─── GeoJSON ───────────────────────────────────────────────────────────────

const validPos = (p: unknown): p is Position =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= 360 && Math.abs(p[1] as number) <= 90;

function cleanRing(r: unknown): Position[] | null {
  if (!Array.isArray(r)) return null;
  const ring = r.filter(validPos).map((p) => [p[0]!, p[1]!]);
  return ring.length >= 4 ? ring : null;
}

function cleanPolygon(rings: unknown): Position[][] | null {
  if (!Array.isArray(rings)) return null;
  const outer = cleanRing(rings[0]);
  if (!outer) return null;
  return [outer, ...rings.slice(1).map(cleanRing).filter((r): r is Position[] => !!r)];
}

/** Features from a FeatureCollection (or a bare array); anything else is empty. */
export function featuresOf(raw: unknown): Feature[] {
  const list = Array.isArray(raw) ? raw : (raw as { features?: unknown } | null)?.features;
  if (!Array.isArray(list)) return [];
  return list.filter((f): f is Feature => !!f && typeof f === "object" && (f as Feature).type === "Feature");
}

/**
 * Keeps the features that belong to `storm`. A bin is reused once a storm
 * ends, so a feature whose storm number and name both contradict the storm
 * (stale GIS data) is dropped. Features without those attributes are kept.
 */
export function stormFeatures(raw: unknown, storm: Pick<TropicalStorm, "id" | "name">): Feature[] {
  const want = stormNumber(storm.id);
  const name = storm.name.toLowerCase();
  return featuresOf(raw).filter((f) => {
    const p = (f.properties ?? {}) as Props;
    const n = num(attr(p, "stormnum"));
    const nm = str(attr(p, "stormname"))?.toLowerCase();
    const numOk = n != null && n > 0 && Number.isFinite(want) ? n === want : null;
    const nameOk = nm ? nm.includes(name) || name.includes(nm) : null;
    if (numOk === true || nameOk === true) return true;
    return numOk !== false && nameOk !== false;
  });
}

/** Every cone polygon merged into one Polygon (one part) or MultiPolygon. */
export function mergePolygons(raw: unknown): Polygon | MultiPolygon | null {
  const parts: Position[][][] = [];
  for (const f of featuresOf(raw)) {
    const g = f.geometry;
    if (g?.type === "Polygon") {
      const p = cleanPolygon(g.coordinates);
      if (p) parts.push(p);
    } else if (g?.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates) {
        const p = cleanPolygon(poly);
        if (p) parts.push(p);
      }
    }
  }
  if (!parts.length) return null;
  return parts.length === 1 ? { type: "Polygon", coordinates: parts[0]! } : { type: "MultiPolygon", coordinates: parts };
}

/** Feature order: ArcGIS object ids when every feature has one, else as served. */
function ordered(features: Feature[]): Feature[] {
  const id = (f: Feature) => num(f.id ?? attr((f.properties ?? {}) as Props, "objectid", "fid"));
  return features.every((f) => id(f) != null) ? [...features].sort((a, b) => id(a)! - id(b)!) : features;
}

/**
 * Joins line segments (LineString / MultiLineString features, e.g. a past
 * track split per stage) into one LineString. Point features are joined
 * only when there are no lines. Consecutive duplicate vertices are dropped.
 */
export function mergeLines(raw: unknown): LineString | null {
  const features = ordered(featuresOf(raw));
  const lines: unknown[][] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g?.type === "LineString") lines.push(g.coordinates);
    else if (g?.type === "MultiLineString" && Array.isArray(g.coordinates)) lines.push(...g.coordinates);
  }
  if (!lines.length) lines.push(features.map((f) => (f.geometry?.type === "Point" ? f.geometry.coordinates : null)));
  const coords: Position[] = [];
  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    for (const p of line) {
      if (!validPos(p)) continue;
      const last = coords.at(-1);
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      coords.push([p[0]!, p[1]!]);
    }
  }
  return coords.length >= 2 ? { type: "LineString", coordinates: coords } : null;
}

// ─── Forecast points ───────────────────────────────────────────────────────

const ZONES: Record<string, number> = {
  UTC: 0, GMT: 0, Z: 0,
  AST: -4, ADT: -3, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
  AKST: -9, AKDT: -8, HST: -10, SST: -11, CHST: 10,
};
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function zoned(y: number, mo: number, d: number, h: number, mi: number, ampm: string | undefined, zone: string): number | null {
  const off = ZONES[zone.toUpperCase()];
  if (off == null || h > 23 || mi > 59) return null;
  let hh = h;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    hh = (h % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);
  }
  const t = Date.UTC(y, mo, d, hh, mi) - off * 3_600_000;
  return Number.isFinite(t) ? t : null;
}

/** "2024-10-09 7:00 PM Wed CDT" (NHC FLDATELBL). */
function parseLocalLabel(v: unknown): number | null {
  const m = str(v)?.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*([AP]M)?(?:\s+[A-Za-z]{3})?\s+([A-Za-z]{1,4})$/i);
  return m ? zoned(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6], m[7]!) : null;
}

/** "1000 PM CDT Tue Oct 08 2024" (NHC ADVDATE) or "241008/0300" (yymmdd/hhmm UTC). */
function parseAdvDate(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,4})\s*([AP]M)\s+([A-Za-z]{1,4})\s+[A-Za-z]{3}\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s+(\d{4})$/i);
  if (m) {
    const hm = m[1]!.padStart(m[1]!.length <= 2 ? 2 : 4, "0");
    const h = +hm.slice(0, 2);
    const mi = hm.length > 2 ? +hm.slice(2) : 0;
    const mo = MONTHS.indexOf(m[4]!.toUpperCase());
    return mo < 0 ? null : zoned(+m[6]!, mo, +m[5]!, h, mi, m[2], m[3]!);
  }
  const c = s.match(/^(\d{2})(\d{2})(\d{2})\/(\d{2})(\d{2})$/);
  return c ? Date.UTC(2000 + +c[1]!, +c[2]! - 1, +c[3]!, +c[4]!, +c[5]!) : null;
}

/** "08/1800" (day/hhmm UTC, NHC VALIDTIME), resolved to the month nearest `ref`. */
function parseDayTime(v: unknown, ref: number | null): number | null {
  const m = str(v)?.match(/^(\d{1,2})\/(\d{2})(\d{2})Z?$/i);
  if (!m || ref == null) return null;
  const [d, h, mi] = [+m[1]!, +m[2]!, +m[3]!];
  const r = new Date(ref);
  let best: number | null = null;
  for (const dm of [-1, 0, 1]) {
    const t = Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + dm, d, h, mi);
    if (new Date(t).getUTCDate() !== d) continue; // day 31 in a 30-day month
    if (best == null || Math.abs(t - ref) < Math.abs(best - ref)) best = t;
  }
  return best;
}

const toIso = (t: number | null) => (t != null && Number.isFinite(t) ? new Date(t).toISOString() : null);

/**
 * Forecast positions from the ArcGIS "Forecast Points" layer. `refIso` (the
 * advisory time) resolves day/hhmm valid times and forecast hours (TAU).
 * NHC forecast hours count from the synoptic time before the advisory
 * (a 03Z advisory's 12 h point is valid at 12Z), except hour 0 (the advisory
 * position itself).
 */
export function parseForecastPoints(raw: unknown, refIso: string | null): TropicalForecastPoint[] {
  const refParsed = refIso ? Date.parse(refIso) : NaN;
  const out: TropicalForecastPoint[] = [];
  for (const f of featuresOf(raw)) {
    const p = (f.properties ?? {}) as Props;
    const g = f.geometry;
    let lon = g?.type === "Point" && validPos(g.coordinates) ? g.coordinates[0]! : null;
    let lat = g?.type === "Point" && validPos(g.coordinates) ? g.coordinates[1]! : null;
    if (lat == null || lon == null) {
      lat = parseCoordinate(attr(p, "lat", "latitude"), null, "lat");
      lon = parseCoordinate(attr(p, "lon", "long", "longitude"), null, "lon");
    }
    if (lat == null || lon == null) continue;

    const windRaw = num(attr(p, "maxwind", "maxwnd", "intensity", "vmax", "wind"));
    const windKt = windRaw != null && windRaw >= 0 && windRaw < 250 ? windRaw : null;
    const ssnum = num(attr(p, "ssnum"));
    const stage = stageOf(attr(p, "dvlbl")) ?? stageOf(attr(p, "stormtype")) ?? stageOf(attr(p, "tcdvlp"));
    const tau = num(attr(p, "tau", "fcsthr", "fhour"));
    const advTime = parseAdvDate(attr(p, "advdate")) ?? isoMs(attr(p, "advdate"));
    const ref = advTime ?? (Number.isFinite(refParsed) ? refParsed : null);

    let time: number | null = null;
    for (const k of ["fldatelbl", "validtime", "time", "datetime", "dtg"]) {
      const v = attr(p, k);
      if (v == null) continue;
      time = isoMs(v) ?? parseLocalLabel(v) ?? parseDayTime(v, ref);
      if (time != null) break;
    }
    if (time == null && tau != null && ref != null) {
      time = tau === 0 ? ref : Math.floor(ref / 21_600_000) * 21_600_000 + tau * 3_600_000;
    }

    const gust = num(attr(p, "gust"));
    const mslp = num(attr(p, "mslp", "minpres", "pressure"));
    out.push({
      lat,
      lon,
      time: toIso(time),
      windKt,
      label: intensityLabel(stage, windKt, ssnum),
      tau: tau != null && tau >= 0 ? tau : null,
      gustKt: gust != null && gust > 0 && gust < 300 ? gust : null,
      pressureMb: mslp != null && mslp > 850 && mslp < 1100 ? mslp : null,
    });
  }
  if (out.every((pt) => pt.tau != null)) return out.sort((a, b) => a.tau! - b.tau!);
  if (out.every((pt) => pt.time != null)) return out.sort((a, b) => Date.parse(a.time!) - Date.parse(b.time!));
  return out;
}

function isoMs(v: unknown): number | null {
  const s = isoTime(v);
  return s ? Date.parse(s) : null;
}

/** A forecast track line through the points, when the track layer is missing. */
export function lineThrough(points: Pick<TropicalForecastPoint, "lat" | "lon">[]): LineString | null {
  return mergeLines(points.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })));
}
