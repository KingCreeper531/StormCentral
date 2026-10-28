import {
  AIRPORT_ID,
  AVIATION_TILE_DEG,
  parseTileBox,
  tilesIn,
  type AdvisoryHazard,
  type AdvisoryKind,
  type AirportResponse,
  type AirportRow,
  type AviationAdvisoriesResponse,
  type AviationAdvisory,
  type AviationMetarsResponse,
} from "../aviation";
import { decodeMetar, FLIGHT_CATEGORIES, type FlightCategory } from "../aviation/decode";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, upstreamJson } from "./upstream";

/**
 * Aviation weather from aviationweather.gov's Data API (NOAA Aviation Weather
 * Center; free, public domain). Its documentation asks for a descriptive
 * User-Agent (upstreamJson sends USER_AGENT), rate-limits requests and points
 * bulk users to its cache files. So:
 *  - airports load by 10° tile (lib/aviation), each tile cached 5 minutes and
 *    shared by everyone viewing it, and only id, position and flight
 *    category go to the map;
 *  - one airport's full METAR (5 min) and TAF (15 min) load when its card opens;
 *  - SIGMETs and G-AIRMETs are one small national set, cached 5 minutes.
 * The Data API answers 204 (no body) when nothing matches: that reads as empty.
 */

const AWC = "https://aviationweather.gov/api/data";
const MIN = 60_000;
/** Reports older than this are left off the map: the station has stopped reporting. */
const STALE_MS = 3 * 3_600_000;
/** A G-AIRMET snapshot stands for the 3 hours until the next one. */
const GAIRMET_STEP_MS = 3 * 3_600_000;

const round3 = (v: number) => Math.round(v * 1e3) / 1e3;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Epoch ms from the API's times: Unix seconds, or an ISO string. */
export function apiTime(v: unknown): number | null {
  const n = num(v);
  if (n != null) return n < 1e12 ? n * 1000 : n;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

/** The Data API's JSON, with an empty answer (204) as an empty list. */
async function awcJson(path: string): Promise<unknown> {
  try {
    return (await upstreamJson(`${AWC}/${path}`, { timeoutMs: 20_000 })) ?? [];
  } catch (err) {
    if (err instanceof SyntaxError) return [];
    throw err;
  }
}
const list = (raw: unknown): Record<string, unknown>[] => (Array.isArray(raw) ? raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object") : []);

// ── METARs ───────────────────────────────────────────────────────────────────
/**
 * `metar?format=json` rows: { icaoId, lat, lon, obsTime (Unix s), reportTime,
 * rawOb, fltCat, name, elev, visib, clouds, temp, dewp, wdir, wspd, altim… }.
 * The category is worked out from the report itself (lib/aviation/decode),
 * with the API's own `fltCat` when the report can't be read.
 */
export function parseMetarRows(raw: unknown, nowMs = Date.now()): AirportRow[] {
  const newest = new Map<string, { row: AirportRow; time: number }>();
  for (const m of list(raw)) {
    const id = typeof m.icaoId === "string" ? m.icaoId.trim().toUpperCase() : "";
    const lat = num(m.lat);
    const lon = num(m.lon);
    if (!AIRPORT_ID.test(id) || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const time = apiTime(m.obsTime) ?? apiTime(m.reportTime);
    if (time == null || nowMs - time > STALE_MS) continue;
    const prev = newest.get(id);
    if (prev && prev.time >= time) continue;
    const decoded = typeof m.rawOb === "string" ? decodeMetar(m.rawOb, time) : null;
    const category = decoded?.category ?? categoryOf(m.fltCat);
    newest.set(id, { row: [id, round3(lat), round3(lon), category], time });
  }
  return [...newest.values()].map((v) => v.row);
}

const categoryOf = (v: unknown): FlightCategory | null => (FLIGHT_CATEGORIES as readonly unknown[]).includes(v) ? (v as FlightCategory) : null;

export const aviationMetarsFeed: Feed<AviationMetarsResponse> = {
  path: "/api/aviation/metars",
  maxAge: 300,
  async load(sp) {
    const box = parseTileBox(sp.get("bbox"));
    if (!box) throw badParams(`bbox must be west,south,east,north on the ${AVIATION_TILE_DEG}° grid, a few tiles at most`);
    const tiles = tilesIn(box);
    const results = await Promise.allSettled(
      tiles.map(([lat, lon]) =>
        cached(`aviation:metars:${lat},${lon}`, 5 * MIN, async () =>
          // The Data API's bbox is lat0,lon0,lat1,lon1.
          parseMetarRows(await awcJson(`metar?format=json&bbox=${lat},${lon},${lat + AVIATION_TILE_DEG},${lon + AVIATION_TILE_DEG}`)),
        ),
      ),
    );
    const ok = results.filter((r): r is PromiseFulfilledResult<AirportRow[]> => r.status === "fulfilled");
    if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
    // An airport on a tile edge comes back from both tiles.
    const airports = new Map<string, AirportRow>();
    for (const r of ok) for (const row of r.value) airports.set(row[0], row);
    return { airports: [...airports.values()], updated: new Date().toISOString() };
  },
};

// ── One airport ──────────────────────────────────────────────────────────────
/** `taf?format=json` rows: { icaoId, issueTime, validTimeFrom, validTimeTo, rawTAF, name, lat, lon, elev, fcsts… }. */
export function parseAirport(id: string, metars: unknown, tafs: unknown): AirportResponse {
  const newest = (rows: Record<string, unknown>[], time: (r: Record<string, unknown>) => number | null) =>
    rows.filter((r) => r.icaoId === id).sort((a, b) => (time(b) ?? 0) - (time(a) ?? 0))[0];
  const m = newest(list(metars), (r) => apiTime(r.obsTime) ?? apiTime(r.reportTime));
  const t = newest(list(tafs), (r) => apiTime(r.issueTime));
  const info = m ?? t;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const metarRaw = text(m?.rawOb);
  const tafRaw = text(t?.rawTAF);
  return {
    id,
    name: text(info?.name),
    lat: num(info?.lat),
    lon: num(info?.lon),
    elevM: num(info?.elev),
    metar: metarRaw ? { raw: metarRaw, time: iso(apiTime(m?.obsTime) ?? apiTime(m?.reportTime)) } : null,
    taf: tafRaw ? { raw: tafRaw, issued: iso(apiTime(t?.issueTime)) } : null,
    updated: new Date().toISOString(),
  };
}

/** `id=KOKC`: that airport's latest METAR and TAF, as sent (the card decodes them). */
export const aviationAirportFeed: Feed<AirportResponse> = {
  path: "/api/aviation/airport",
  maxAge: 300,
  async load(sp) {
    const id = sp.get("id")?.trim().toUpperCase() ?? "";
    if (!AIRPORT_ID.test(id)) throw badParams("id must be an airport id such as KOKC");
    const [metars, tafs] = await Promise.allSettled([
      cached(`aviation:metar:${id}`, 5 * MIN, () => awcJson(`metar?format=json&ids=${id}`)),
      cached(`aviation:taf:${id}`, 15 * MIN, () => awcJson(`taf?format=json&ids=${id}`)),
    ]);
    if (metars.status === "rejected" && tafs.status === "rejected") throw metars.reason;
    return parseAirport(id, metars.status === "fulfilled" ? metars.value : [], tafs.status === "fulfilled" ? tafs.value : []);
  },
};

// ── SIGMETs and AIRMETs ──────────────────────────────────────────────────────
/** The API's hazard names (airsigmet: CONVECTIVE, TURB, ICE, IFR, MTN OBSCN, ASH; gairmet: TURB-HI, MT_OBSC, SFC_WND…). */
export function advisoryHazard(raw: unknown): AdvisoryHazard | null {
  const h = typeof raw === "string" ? raw.toUpperCase().replace(/[_-]+/g, " ") : "";
  // Freezing-level contours are lines, not areas.
  if (/FZLVL/.test(h)) return null;
  if (/CONVECTIVE|^TS/.test(h)) return "convective";
  if (/TURB/.test(h)) return "turbulence";
  if (/ICE|ICING/.test(h)) return "icing";
  if (/IFR/.test(h)) return "ifr";
  if (/MTN?\s*OBSC/.test(h)) return "mountain";
  if (/ASH|^VA\b/.test(h)) return "ash";
  if (/LLWS/.test(h)) return "llws";
  if (/WND|WIND/.test(h)) return "wind";
  return "other";
}

/** [{ lat, lon }, …] (numbers or strings) → a closed [lon, lat] ring, or null under three distinct points. */
export function advisoryRing(coords: unknown): [number, number][] | null {
  const ring: [number, number][] = [];
  for (const c of Array.isArray(coords) ? (coords as { lat?: unknown; lon?: unknown }[]) : []) {
    const lat = num(c?.lat);
    const lon = num(c?.lon);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const p: [number, number] = [round3(lon), round3(lat)];
    const last = ring[ring.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) ring.push(p);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
  return new Set(ring.map((p) => p.join())).size >= 3 ? ring : null;
}

/** Feet from an altitude: feet already, or hundreds of feet ("180" is FL180); SFC is 0. */
function altitudeFt(v: unknown): number | null {
  if (typeof v === "string" && /^SFC$/i.test(v.trim())) return 0;
  const n = num(v);
  if (n == null) return null;
  return n > 0 && n < 1000 ? n * 100 : n;
}

/**
 * `airsigmet?format=json` (US domestic): { airSigmetType: SIGMET | AIRMET |
 * OUTLOOK, hazard, severity, validTimeFrom, validTimeTo (Unix s), altitudeLow1,
 * altitudeHi1/2 (ft), seriesId, rawAirSigmet, coords: [{ lat, lon }] }.
 * Convective outlooks and expired ones are left out.
 */
export function parseAirSigmets(raw: unknown, nowMs = Date.now()): AviationAdvisory[] {
  const out: AviationAdvisory[] = [];
  for (const [i, a] of list(raw).entries()) {
    const type = typeof a.airSigmetType === "string" ? a.airSigmetType.toUpperCase() : "";
    if (type !== "SIGMET" && type !== "AIRMET") continue;
    const hazard = advisoryHazard(a.hazard);
    const ring = advisoryRing(a.coords);
    const from = apiTime(a.validTimeFrom);
    const to = apiTime(a.validTimeTo);
    if (!hazard || !ring || from == null || to == null || to <= nowMs) continue;
    const kind: AdvisoryKind = type === "AIRMET" ? "airmet" : hazard === "convective" ? "convective" : "sigmet";
    const tops = [altitudeFt(a.altitudeHi1), altitudeFt(a.altitudeHi2)].filter((v): v is number => v != null);
    const series = typeof a.seriesId === "string" && a.seriesId.trim() ? a.seriesId.trim() : String(i);
    out.push({
      id: `${kind}:${series}:${from / 1000}:${i}`,
      kind,
      hazard,
      from: iso(from)!,
      to: iso(to)!,
      baseFt: altitudeFt(a.altitudeLow1),
      topFt: tops.length ? Math.max(...tops) : null,
      text: typeof a.rawAirSigmet === "string" ? a.rawAirSigmet.trim() : "",
      ring,
    });
  }
  return out;
}

/**
 * `gairmet?format=json`: snapshots every 3 hours, { tag, forecastHour,
 * validTime, product (SIERRA, TANGO, ZULU), hazard, geometryType, dueTo,
 * severity, base, top, coords }. Only the snapshot nearest now is kept
 * (one per product), and only areas (freezing levels are contour lines).
 */
export function parseGairmets(raw: unknown, nowMs = Date.now()): AviationAdvisory[] {
  const rows = list(raw).filter((g) => (typeof g.geometryType !== "string" || g.geometryType.toUpperCase() === "AREA") && apiTime(g.validTime) != null);
  // Each product's snapshot closest to now.
  const nearest = new Map<string, number>();
  for (const g of rows) {
    const product = String(g.product ?? "");
    const t = apiTime(g.validTime)!;
    const best = nearest.get(product);
    if (best == null || Math.abs(t - nowMs) < Math.abs(best - nowMs)) nearest.set(product, t);
  }
  const out: AviationAdvisory[] = [];
  for (const [i, g] of rows.entries()) {
    const product = String(g.product ?? "");
    const at = apiTime(g.validTime)!;
    if (at !== nearest.get(product)) continue;
    const hazard = advisoryHazard(g.hazard);
    const ring = advisoryRing(g.coords);
    if (!hazard || !ring) continue;
    const dueTo = typeof g.dueTo === "string" ? g.dueTo.trim() : typeof g.due_to === "string" ? g.due_to.trim() : "";
    const name = [product, typeof g.hazard === "string" ? g.hazard : "", typeof g.severity === "string" ? g.severity : ""].filter(Boolean).join(" ");
    out.push({
      id: `gairmet:${product}:${typeof g.tag === "string" ? g.tag : i}:${at / 1000}:${i}`,
      kind: "gairmet",
      hazard,
      from: iso(at)!,
      to: iso(at + GAIRMET_STEP_MS)!,
      baseFt: altitudeFt(g.base),
      topFt: altitudeFt(g.top),
      text: dueTo ? `${name}: ${dueTo}` : name,
      ring,
    });
  }
  return out;
}

const GAIRMET_PRODUCTS = ["sierra", "tango", "zulu"] as const;

/** SIGMETs, convective SIGMETs and AIRMETs over the US, with the current G-AIRMET snapshot. */
export const aviationAdvisoriesFeed: Feed<AviationAdvisoriesResponse> = {
  path: "/api/aviation/advisories",
  maxAge: 300,
  async load() {
    const [sigmets, gairmets] = await Promise.allSettled([
      cached("aviation:airsigmet", 5 * MIN, async () => awcJson("airsigmet?format=json")),
      cached("aviation:gairmet", 5 * MIN, async () => (await Promise.all(GAIRMET_PRODUCTS.map((p) => awcJson(`gairmet?format=json&type=${p}`).then(list)))).flat()),
    ]);
    if (sigmets.status === "rejected" && gairmets.status === "rejected") throw sigmets.reason;
    const now = Date.now();
    const unavailable: AviationAdvisoriesResponse["unavailable"] = [];
    const advisories: AviationAdvisory[] = [];
    if (sigmets.status === "fulfilled") advisories.push(...parseAirSigmets(sigmets.value, now));
    else unavailable.push("sigmets");
    if (gairmets.status === "fulfilled") advisories.push(...parseGairmets(gairmets.value, now));
    else unavailable.push("gairmets");
    return { advisories, unavailable, updated: new Date(now).toISOString() };
  },
};
