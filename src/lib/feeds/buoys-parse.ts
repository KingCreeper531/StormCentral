/**
 * Pure parsers for NOAA National Data Buoy Center files (no I/O; unit-tested
 * with samples shaped like the live files):
 *  - latest_obs.txt: the newest observation of every station, one line each,
 *    in fixed-width columns with "MM" for anything the station didn't report.
 *  - activestations.xml: station names and kinds (the observations have none).
 * Columns are found by the header's names, so a column NDBC adds or moves
 * doesn't shift the others.
 */
import type { Buoy, BuoyKind } from "./buoys";

/** latest_obs.txt's columns, for a file that arrives without its header. */
const DEFAULT_COLUMNS = "STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE".split(" ");
/** An observation older than this is a station that stopped reporting. */
const STALE_MS = 6 * 3_600_000;
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A column's number, null for "MM" (missing) and values outside `[min, max]` (sensor faults). */
function value(cells: string[], i: number | undefined, min: number, max: number): number | null {
  const raw = i == null ? undefined : cells[i];
  if (!raw || raw === "MM") return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/** Wind and wave directions (°T): 0–360, with 360 meaning north. */
const direction = (cells: string[], i: number | undefined) => {
  const v = value(cells, i, 0, 360);
  return v == null ? null : v % 360;
};

export interface StationInfo {
  name: string;
  kind: BuoyKind;
}

/**
 * Every station's latest observation, newest-first order kept from the file.
 * `stations` names them (from activestations.xml); a station it doesn't list
 * is named by its id.
 */
export function parseLatestObs(text: string, stations: ReadonlyMap<string, StationInfo> = new Map(), nowMs = Date.now()): Buoy[] {
  let columns = DEFAULT_COLUMNS;
  const out: Buoy[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) {
      // The first header line names the columns ("#STN LAT LON …"); the second gives their units.
      const names = line.slice(1).trim().split(/\s+/);
      if (names[0] === "STN") columns = names;
      continue;
    }
    const cells = line.trim().split(/\s+/);
    if (cells.length < 8) continue;
    const col = (name: string) => {
      const i = columns.indexOf(name);
      return i < 0 ? undefined : i;
    };
    const id = cells[0]!.toUpperCase();
    if (!/^[A-Z0-9]{3,8}$/.test(id) || seen.has(id)) continue;
    const lat = value(cells, col("LAT"), -90, 90);
    const lon = value(cells, col("LON"), -180, 360);
    if (lat == null || lon == null || (lat === 0 && lon === 0)) continue;
    // Date and time are separate UTC columns: YYYY MM DD hh mm.
    const [y, mo, d, h, mi] = ["YYYY", "MM", "DD", "hh", "mm"].map((c) => value(cells, col(c), 0, 9999));
    if (y == null || mo == null || d == null || h == null || mi == null) continue;
    const time = Date.UTC(y, mo - 1, d, h, mi);
    if (!Number.isFinite(time) || nowMs - time > STALE_MS || time - nowMs > 3_600_000) continue;

    const buoy: Buoy = {
      id,
      name: stations.get(id)?.name ?? `Station ${id}`,
      kind: stations.get(id)?.kind ?? "station",
      lat: round(lat, 3),
      lon: round(lon > 180 ? lon - 360 : lon, 3),
      time: new Date(time).toISOString(),
      waveHeight: value(cells, col("WVHT"), 0, 30),
      dominantPeriod: value(cells, col("DPD"), 0, 40),
      waveDir: direction(cells, col("MWD")),
      windDir: direction(cells, col("WDIR")),
      windSpeed: value(cells, col("WSPD"), 0, 100),
      gust: value(cells, col("GST"), 0, 120),
      pressure: value(cells, col("PRES"), 850, 1100),
      airTemp: value(cells, col("ATMP"), -60, 60),
      waterTemp: value(cells, col("WTMP"), -5, 40),
    };
    // A water-level gauge with nothing of this left is no use on this map.
    const { waveHeight, windSpeed, pressure, airTemp, waterTemp } = buoy;
    if ([waveHeight, windSpeed, pressure, airTemp, waterTemp].every((v) => v == null)) continue;
    seen.add(id);
    out.push(buoy);
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

/** Some stations are named in capitals ("EAST HATTERAS"); those read better in title case. */
const unshout = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase()) : s);

/**
 * activestations.xml: `<station id="41001" … name="EAST HATTERAS - 150 NM East of Cape Hatteras" type="buoy" …/>`
 * → id (upper case, as latest_obs writes it) → name and kind. Names in capitals before " - " are title-cased.
 */
export function parseActiveStations(xml: string): Map<string, StationInfo> {
  const out = new Map<string, StationInfo>();
  for (const [, attrs] of xml.matchAll(/<station\b([^>]*?)\/?>/g)) {
    const a: Record<string, string> = {};
    for (const [, k, v] of attrs!.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) a[k!] = unescapeXml(v!);
    const id = a.id?.trim().toUpperCase();
    if (!id) continue;
    const name = (a.name ?? "")
      .split(" - ")
      .map((part) => unshout(part.replace(/\s+/g, " ").trim()))
      .filter(Boolean)
      .join(" - ");
    out.set(id, { name: name || `Station ${id}`, kind: a.type === "buoy" || a.type === "dart" ? "buoy" : "station" });
  }
  return out;
}

/** NDBC's page for a station: its charts, history and the full observation. */
export const ndbcStationUrl = (id: string) => `https://www.ndbc.noaa.gov/station_page.php?station=${encodeURIComponent(id.toLowerCase())}`;
