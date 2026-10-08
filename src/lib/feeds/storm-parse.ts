/**
 * Pure parsers and helpers for the official storm feeds (no I/O; unit-tested
 * with fixtures in storm-parse.test.ts):
 *
 * - Iowa Environmental Mesonet (IEM) Local Storm Report GeoJSON → `StormReport[]`
 * - IEM NEXRAD storm-attribute GeoJSON → `StormCell[]`
 *
 * plus small pure helpers shared by the map layers and panels (severity,
 * forecast track, ETA, labels). Like parse.ts, everything is tolerant:
 * property names in either case, numbers sent as strings, "NONE" / "" / null /
 * negative sentinels read as missing, and junk rows are skipped rather than
 * failing the whole feed.
 */
import type { LatLon } from "../geo";
import { destination, stormEta } from "../science/storm-motion";
import type { StormCell } from "./storm-cells";
import type { StormReport, StormReportKind } from "./storm-reports";

// ─── Tolerant field readers ─────────────────────────────────────────────────

type Props = Record<string, unknown>;

/** Property bag with lower-cased keys (IEM has served both cases). The first non-empty value wins. */
function props(v: unknown): Props {
  const out: Props = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, val] of Object.entries(v as Props)) {
    const key = k.toLowerCase();
    if (out[key] == null || out[key] === "") out[key] = val;
  }
  return out;
}

/** First present, non-empty value among `keys`. */
function pick(p: Props, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = p[k];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

const NULLISH = new Set(["NONE", "NULL", "NAN", "N/A"]);

/** Trimmed string, or null when empty / "NONE". Finite numbers are stringified. */
function str(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s && !NULLISH.has(s.toUpperCase()) ? s : null;
}

/** A finite number from a number or numeric string; null otherwise (never 0 for "" or null). */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Non-negative attribute: IEM marks missing values with negative sentinels (-1, -99, -999). */
function attr(v: unknown): number | null {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
}

/** A percentage, 0–100. */
function pct(v: unknown): number | null {
  const n = attr(v);
  return n != null && n <= 100 ? n : null;
}

/**
 * IEM timestamps → ISO (UTC). Accepts "2026-10-07T21:12:00Z", "2026-10-07 21:12",
 * "2026-10-07T21:12:00+00", "202610072112" and epoch seconds or milliseconds.
 * Zone-less times are UTC (IEM's `valid` is always UTC).
 */
export function iemTime(v: unknown): string | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    return new Date(v > 1e11 ? v : v * 1000).toISOString();
  }
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;
  const compact = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?$/.exec(s);
  if (compact) {
    const [, y, mo, d, h, mi, sec] = compact;
    s = `${y}-${mo}-${d}T${h}:${mi}:${sec ?? "00"}Z`;
  } else {
    s = s.replace(" ", "T").replace(/(T\d\d:\d\d(?::\d\d(?:\.\d+)?)?[+-]\d\d)$/, "$1:00");
    if (!/(Z|[+-]\d\d:?\d\d)$/i.test(s)) s += "Z";
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** GeoJSON Point coordinates, falling back to lat/lon properties. Null Island counts as missing. */
function pointOf(f: { geometry?: unknown }, p: Props): LatLon | null {
  const g = f.geometry as { type?: unknown; coordinates?: unknown } | null | undefined;
  let lat: number | null = null;
  let lon: number | null = null;
  if (g && (g.type === undefined || g.type === "Point") && Array.isArray(g.coordinates)) {
    lon = num(g.coordinates[0]);
    lat = num(g.coordinates[1]);
  }
  if (lat == null || lon == null) {
    lat = num(pick(p, "lat", "latitude"));
    lon = num(pick(p, "lon", "lng", "long", "longitude"));
  }
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

function featuresOf(raw: unknown): Record<string, unknown>[] {
  const features = (raw as { features?: unknown } | null | undefined)?.features;
  if (!Array.isArray(features)) return [];
  return features.filter((f): f is Record<string, unknown> => !!f && typeof f === "object");
}

// ─── Local storm reports (IEM LSR GeoJSON) ──────────────────────────────────

/**
 * Report kind from the NWS type text. Order matters: "FUNNEL" before
 * "TORNADO", winter types before "RAIN" (freezing rain is winter weather) and
 * "WIND CHILL" is a temperature report, not wind. Waterspouts count as
 * tornadoes (a tornado over water); the type text still says "Waterspout".
 */
const KIND_RULES: [RegExp, StormReportKind][] = [
  [/FUNNEL|WALL CLOUD/, "funnel"],
  [/TORNADO|LANDSPOUT|WATERSPOUT/, "tornado"],
  [/HAIL/, "hail"],
  [/CHILL/, "other"],
  [/\b(WND|WIND|TSTM) ?(DMG|DAMAGE)\b|DOWNBURST|MICROBURST/, "wind-damage"],
  [/\bWND\b|WIND|GUST/, "wind"],
  [/FLOOD|DEBRIS FLOW|STORM SURGE|SEICHE/, "flood"],
  [/SNOW|SLEET|BLIZZARD|FREEZING|\bICE\b/, "snow"],
  [/RAIN/, "rain"],
];

/**
 * IEM's one-letter LSR type codes, used only when `typetext` is missing.
 * Best effort: these are the long-standing, common codes.
 */
const TYPE_CODES: Record<string, [text: string, kind: StormReportKind]> = {
  T: ["TORNADO", "tornado"],
  C: ["FUNNEL CLOUD", "funnel"],
  W: ["WATERSPOUT", "tornado"],
  H: ["HAIL", "hail"],
  G: ["TSTM WND GST", "wind"],
  D: ["TSTM WND DMG", "wind-damage"],
  M: ["MARINE TSTM WIND", "wind"],
  N: ["NON-TSTM WND GST", "wind"],
  O: ["NON-TSTM WND DMG", "wind-damage"],
  F: ["FLASH FLOOD", "flood"],
  E: ["FLOOD", "flood"],
  R: ["HEAVY RAIN", "rain"],
  S: ["SNOW", "snow"],
  Z: ["BLIZZARD", "snow"],
};

export function lsrKind(typeText: string | null | undefined, code?: string | null): StormReportKind {
  const t = (typeText ?? "").toUpperCase();
  if (t) for (const [re, kind] of KIND_RULES) if (re.test(t)) return kind;
  if (!t && code) return TYPE_CODES[code.toUpperCase()]?.[1] ?? "other";
  return "other";
}

/** The five buckets the reports summary counts. */
export type ReportGroup = "tornado" | "hail" | "wind" | "flood" | "other";
export const REPORT_GROUPS: readonly ReportGroup[] = ["tornado", "hail", "wind", "flood", "other"];

export function reportGroup(kind: StormReportKind): ReportGroup {
  switch (kind) {
    case "tornado":
    case "hail":
    case "flood":
      return kind;
    case "wind":
    case "wind-damage":
      return "wind";
    default:
      return "other";
  }
}

/**
 * LSR magnitude: a number, or text such as "1.75", "E61 MPH", "M1.00 INCH" or
 * "EF2". Zero, negative and trace ("T") magnitudes read as missing.
 */
export function parseMagnitude(v: unknown): { value: number | null; qualifier: string | null; unit: string | null } {
  const none = { value: null, qualifier: null, unit: null };
  if (typeof v === "number") return { ...none, value: Number.isFinite(v) && v > 0 ? v : null };
  const s = str(v)?.toUpperCase();
  if (!s) return none;
  const rating = /^(E?F)\s*(\d)$/.exec(s);
  if (rating) return { value: Number(rating[2]), qualifier: null, unit: "EF" };
  const m = /^([EMU])?\s*(\d+(?:\.\d*)?|\.\d+)\s*([A-Z/]+(?: [A-Z/]+)*)?$/.exec(s);
  if (!m) return none;
  const value = Number(m[2]);
  return { value: Number.isFinite(value) && value > 0 ? value : null, qualifier: m[1] ?? null, unit: m[3] ?? null };
}

/** Stable id: minute of observation, position and type, so re-sent reports collapse. */
function reportId(time: string, p: LatLon, typeText: string) {
  const minute = time.slice(0, 16).replace(/[-:T]/g, "");
  const type = typeText.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${minute}_${p.lat.toFixed(3)}_${p.lon.toFixed(3)}_${type}`;
}

/**
 * IEM LSR GeoJSON → reports, newest first. Rows without a position, time or
 * type are skipped; duplicates (summary LSRs repeat earlier reports) collapse
 * onto one id.
 */
export function parseLsrGeoJson(raw: unknown): StormReport[] {
  const byId = new Map<string, StormReport>();
  for (const f of featuresOf(raw)) {
    const p = props(f.properties);
    const pos = pointOf(f, p);
    const time = iemTime(pick(p, "valid", "utc_valid", "utcvalid", "valid_utc", "time"));
    if (!pos || !time) continue;

    // `type` is IEM's one-letter code; tolerate the full text there too.
    const rawCode = str(pick(p, "typecode", "type_code", "type"));
    const code = rawCode && rawCode.length <= 2 ? rawCode.toUpperCase() : null;
    const typeText = (str(pick(p, "typetext", "type_text", "event")) ?? (rawCode && !code ? rawCode : null) ?? (code ? TYPE_CODES[code]?.[0] : null))?.toUpperCase();
    if (!typeText) continue;
    const kind = lsrKind(typeText, code);

    const mag = parseMagnitude(pick(p, "magnitude", "mag"));
    const unit = str(pick(p, "unit", "units"))?.toUpperCase() ?? mag.unit ?? (kind === "hail" ? "INCH" : null);
    const qualifier = (str(pick(p, "qualifier", "qualify", "qual")) ?? mag.qualifier)?.charAt(0).toUpperCase() ?? null;

    const report: StormReport = {
      id: reportId(time, pos, typeText),
      time,
      kind,
      typeText,
      magnitude: mag.value,
      unit: mag.value != null ? unit : null,
      // The qualifier describes the magnitude; without one it means nothing.
      measured: mag.value == null ? null : qualifier === "M" ? true : qualifier === "E" ? false : null,
      place: str(pick(p, "city", "place", "location")) ?? "",
      county: str(pick(p, "county")),
      state: str(pick(p, "state", "st"))?.toUpperCase() ?? null,
      source: str(pick(p, "source")),
      remark: str(pick(p, "remark", "remarks", "comments")),
      wfo: str(pick(p, "wfo"))?.toUpperCase() ?? null,
      lat: pos.lat,
      lon: pos.lon,
    };
    if (!byId.has(report.id)) byId.set(report.id, report);
  }
  // ISO strings from toISOString() sort chronologically.
  return [...byId.values()].sort((a, b) => b.time.localeCompare(a.time) || a.id.localeCompare(b.id));
}

/** `hours` query value → whole hours 1–24 (default 6); null when it isn't a number. */
export function parseHours(raw: string | null | undefined, fallback = 6): number | null {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(24, Math.max(1, Math.round(n)));
}

const WINDOW_STEP_MS = 2 * 60_000;
const iemStamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, "");

/**
 * IEM `sts`/`ets` (YYYYmmddHHMM, UTC) for the last `hours`. The end rounds UP
 * to the next 2 minutes, so every client in that window shares one cache key
 * and the newest reports are still inside it.
 */
export function lsrWindow(nowMs: number, hours: number): { sts: string; ets: string } {
  const end = Math.ceil(nowMs / WINDOW_STEP_MS) * WINDOW_STEP_MS;
  return { sts: iemStamp(end - hours * 3_600_000), ets: iemStamp(end) };
}

// ─── NEXRAD storm attributes (IEM nexrad_attr GeoJSON) ──────────────────────

/** Mesocyclone detection strength rank at which a circulation counts as a mesocyclone. */
export const MESO_RANK = 5;

/**
 * Mesocyclone strength: a rank number (MDA, e.g. "7" or "5L" for low-topped),
 * or the legacy text "MESO" (read as the threshold rank). "NONE", 0 and the
 * legacy shear-only classes ("UNCOR", "3DCOR") are no mesocyclone.
 */
function parseMeso(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const s = str(v)?.toUpperCase();
  if (!s) return null;
  const rank = /^(\d+)/.exec(s);
  if (rank) return Number(rank[1]) > 0 ? Number(rank[1]) : null;
  return s === "MESO" ? MESO_RANK : null;
}

function parseTvs(v: unknown): StormCell["tvs"] {
  const s = str(v)?.toUpperCase();
  return s === "TVS" || s === "ETVS" ? s : null;
}

/**
 * Cell motion. ASSUMPTION: IEM's `drct` follows the meteorological convention
 * (the direction the storm moves FROM, like the NWS warning motion line) and
 * `sknt` is knots. New cells have no motion yet; IEM stores them as 0°/0 kt
 * or nulls, both of which read as unknown here.
 */
function motionOf(drct: number | null, sknt: number | null): StormCell["motion"] {
  if (drct == null || sknt == null || drct > 360) return null;
  if (drct === 0 && sknt === 0) return null;
  return { fromDeg: drct % 360, speedKt: sknt };
}

export interface NexradAttrOptions {
  /** Drop cells whose scan is older than `maxAgeMin` before this time (ms). */
  now?: number;
  maxAgeMin?: number;
}

/**
 * IEM NEXRAD storm attributes → cells, most severe first. Rows need a
 * position, a radar + storm id (from the properties or a feature id such as
 * "TLX_A3"), a scan time and at least one meaningful attribute.
 */
export function parseNexradAttr(raw: unknown, { now, maxAgeMin = 45 }: NexradAttrOptions = {}): StormCell[] {
  const fallbackTime = iemTime(pick(props(raw), "generation_time", "generated_at", "valid"));
  const byId = new Map<string, StormCell>();
  for (const f of featuresOf(raw)) {
    const p = props(f.properties);
    const pos = pointOf(f, p);
    if (!pos) continue;

    let radar = str(pick(p, "nexrad", "radar", "site", "wsr"))?.toUpperCase() ?? null;
    let stormId = str(pick(p, "storm_id", "stormid", "storm", "cell_id"))?.toUpperCase() ?? null;
    if (!radar || !stormId) {
      const m = /^([A-Z0-9]{3,4})[_\-\s]([A-Z0-9]{1,3})$/i.exec(String(f.id ?? ""));
      radar ??= m?.[1]?.toUpperCase() ?? null;
      stormId ??= m?.[2]?.toUpperCase() ?? null;
    }
    if (!radar || !stormId) continue;

    const time = iemTime(pick(p, "valid", "utc_valid", "time")) ?? fallbackTime;
    if (!time) continue;
    if (now != null && maxAgeMin > 0 && now - Date.parse(time) > maxAgeMin * 60_000) continue;

    const cell: StormCell = {
      id: `${radar}-${stormId}`,
      radar,
      stormId,
      lat: pos.lat,
      lon: pos.lon,
      time,
      hailProb: pct(pick(p, "poh")),
      severeHailProb: pct(pick(p, "posh")),
      maxHailIn: attr(pick(p, "max_size", "maxsize", "max_hail")),
      meso: parseMeso(pick(p, "meso", "mda")),
      tvs: parseTvs(pick(p, "tvs")),
      vil: attr(pick(p, "vil")),
      maxDbz: attr(pick(p, "max_dbz", "maxdbz", "dbzm")),
      topKft: attr(pick(p, "top", "echo_top")),
      motion: motionOf(attr(pick(p, "drct", "dir")), attr(pick(p, "sknt", "speed"))),
      maxDbzHeightKft: attr(pick(p, "max_dbz_height", "max_dbz_hgt")),
      azimuthDeg: attr(pick(p, "azimuth", "az")),
      rangeNm: attr(pick(p, "range", "rng")),
    };
    const meaningful =
      cell.tvs ||
      cell.meso != null ||
      (cell.severeHailProb ?? 0) > 0 ||
      (cell.hailProb ?? 0) > 0 ||
      (cell.maxHailIn ?? 0) > 0 ||
      (cell.vil ?? 0) > 0 ||
      cell.maxDbz != null ||
      (cell.topKft ?? 0) > 0 ||
      cell.motion;
    if (!meaningful) continue;

    const prev = byId.get(cell.id);
    if (!prev || cell.time > prev.time) byId.set(cell.id, cell);
  }
  return [...byId.values()].sort(
    (a, b) => cellSeverity(b) - cellSeverity(a) || (b.severeHailProb ?? -1) - (a.severeHailProb ?? -1) || a.id.localeCompare(b.id),
  );
}

// ─── Cell severity, track and ETA ───────────────────────────────────────────

/**
 * 4 tornado vortex signature · 3 mesocyclone · 2 severe hail (≥ 1" or POSH ≥ 50%)
 * · 1 worth watching (POSH ≥ 30% or a weak circulation) · 0 ordinary cell.
 * Levels ≥ 1 stay visible when the map is zoomed out.
 */
export type CellLevel = 0 | 1 | 2 | 3 | 4;

export function cellSeverity(c: Pick<StormCell, "tvs" | "meso" | "maxHailIn" | "severeHailProb">): CellLevel {
  if (c.tvs) return 4;
  if (c.meso != null && c.meso >= MESO_RANK) return 3;
  if ((c.maxHailIn ?? 0) >= 1 || (c.severeHailProb ?? 0) >= 50) return 2;
  if ((c.severeHailProb ?? 0) >= 30 || (c.meso ?? 0) > 0) return 1;
  return 0;
}

/** Forecast minutes after the scan, as the radar's own storm tracking reports them. */
export const TRACK_MINUTES = [15, 30, 45, 60] as const;

/** Heading the cell moves toward: the FROM direction + 180° (see `motionOf`). */
export const cellHeading = (m: NonNullable<StormCell["motion"]>) => (m.fromDeg + 180) % 360;

/**
 * Forecast positions from the scan position and motion, measured from the
 * scan time. Empty for cells without usable motion (under 1 kt).
 */
export function cellTrack(
  c: Pick<StormCell, "lat" | "lon" | "motion">,
  minutes: readonly number[] = TRACK_MINUTES,
): { minutes: number; lat: number; lon: number }[] {
  if (!c.motion || c.motion.speedKt < 1) return [];
  const kmPerMin = (c.motion.speedKt * 1.852) / 60;
  const heading = cellHeading(c.motion);
  return minutes.map((m) => ({ minutes: m, ...destination({ lat: c.lat, lon: c.lon }, heading, kmPerMin * m) }));
}

/**
 * Minutes until the cell reaches `p`, extrapolated from its scan to `now`;
 * null when it's moving away, will pass more than `corridorKm` to either
 * side, or is further out than `horizonMin` (cell tracking is only forecast
 * an hour ahead).
 */
export function cellEta(
  c: Pick<StormCell, "lat" | "lon" | "time" | "motion">,
  p: LatLon,
  { now = Date.now(), corridorKm = 10, horizonMin = 60 }: { now?: number; corridorKm?: number; horizonMin?: number } = {},
): number | null {
  if (!c.motion || c.motion.speedKt < 1) return null;
  const eta = stormEta(
    { headingDeg: cellHeading(c.motion), speedKt: c.motion.speedKt, positions: [[c.lon, c.lat]], time: c.time },
    p,
    corridorKm,
    now,
  );
  return eta != null && eta <= horizonMin ? eta : null;
}

// ─── Report presentation (pure) ─────────────────────────────────────────────

export type ReportMagnitude =
  | { kind: "length"; mm: number }
  | { kind: "speed"; ms: number }
  | { kind: "rating"; text: string }
  | { kind: "other"; value: number; unit: string | null };

/**
 * Magnitude in SI so the UI can format it in the user's units. Hail without a
 * unit is inches and wind is mph, as in every US LSR.
 */
export function reportMagnitude(r: Pick<StormReport, "kind" | "magnitude" | "unit">): ReportMagnitude | null {
  const v = r.magnitude;
  if (v == null) return null;
  const u = (r.unit ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const windy = r.kind === "wind" || r.kind === "wind-damage";
  if (u === "INCH" || u === "INCHES" || u === "IN" || (!u && r.kind === "hail")) return { kind: "length", mm: v * 25.4 };
  if (u === "MM") return { kind: "length", mm: v };
  if (u === "CM") return { kind: "length", mm: v * 10 };
  if (u === "MPH" || (!u && windy)) return { kind: "speed", ms: v / 2.236936 };
  if (u === "KT" || u === "KTS" || u === "KNOT" || u === "KNOTS") return { kind: "speed", ms: v / 1.943844 };
  if (u === "KMH" || u === "KPH") return { kind: "speed", ms: v / 3.6 };
  if (r.kind === "tornado" && (u === "EF" || u === "F")) return { kind: "rating", text: `EF${Math.round(v)}` };
  return { kind: "other", value: v, unit: r.unit };
}

const ABBREVIATIONS: [RegExp, string][] = [
  [/\btstm\b/g, "thunderstorm"],
  [/\bwnd\b/g, "wind"],
  [/\bgst\b/g, "gust"],
  [/\bdmg\b/g, "damage"],
  [/\bsust\b/g, "sustained"],
  [/\bextr\b/g, "extreme"],
  [/\bastr\b/g, "astronomical"],
];

/** NWS type text in sentence case with abbreviations spelled out: "TSTM WND GST" → "Thunderstorm wind gust". */
export function reportTitle(typeText: string): string {
  let s = typeText.trim().replace(/\s+/g, " ").toLowerCase();
  for (const [re, word] of ABBREVIATIONS) s = s.replace(re, word);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const KEEP_UPPER = new Set([...COMPASS_POINTS, "US", "SR", "CR", "FM", "AFB", "NAS", "II", "III", "IV"]);
const SMALL_WORDS = new Set(["of", "and", "the", "at", "on"]);

/**
 * NWS place names arrive in capitals ("3 NW AMES"). Title-case them, keeping
 * compass points and route prefixes upper case: "3 NW Ames", "US-30".
 * Text that already has lower case is left alone.
 */
export function placeName(s: string | null | undefined): string {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  if (!t || /[a-z]/.test(t)) return t;
  return t
    .split(" ")
    .map((word, i) =>
      word
        .split(/([-/])/)
        .map((seg) => {
          const up = seg.toUpperCase();
          if (KEEP_UPPER.has(up)) return up;
          const low = seg.toLowerCase();
          if (i > 0 && SMALL_WORDS.has(low)) return low;
          return low.replace(/(^|[.'(])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase());
        })
        .join(""),
    )
    .join(" ");
}

const ACRONYMS: Record<string, string> = {
  NWS: "NWS",
  NOAA: "NOAA",
  ASOS: "ASOS",
  AWOS: "AWOS",
  CWOP: "CWOP",
  DOT: "DOT",
  FAA: "FAA",
  USGS: "USGS",
  EM: "EM",
  COCORAHS: "CoCoRaHS",
};

/** Report source in sentence case: "EMERGENCY MNGR" → "Emergency manager", "NWS STORM SURVEY" → "NWS storm survey". */
export function sourceLabel(s: string | null | undefined): string {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  if (!t || /[a-z]/.test(t)) return t;
  return t
    .replace(/\bMNGR\b/g, "MANAGER")
    .replace(/\bDEPT\b/g, "DEPARTMENT")
    .split(" ")
    .map((w, i) => {
      const known = ACRONYMS[w.toUpperCase()];
      if (known) return known;
      const low = w.toLowerCase();
      return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
    })
    .join(" ");
}
