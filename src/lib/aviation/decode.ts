import { translator, type Translator } from "../i18n/core";

/**
 * METAR and TAF decoding, and the FAA flight categories, for the aviation
 * layer on the radar map. Pure: the feed uses it to colour the airport dots,
 * the airport card to explain the reports. Follows the US format (FAA order
 * JO 7900.5 / FMH-1) and reads the ICAO one too (metres, Q altimeter, CAVOK).
 *
 * Units stay the ones pilots use: knots, statute miles, feet. Unknown groups
 * are skipped (kept in `unparsed`), so a new or odd group never breaks a report.
 */

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";
export const FLIGHT_CATEGORIES: readonly FlightCategory[] = ["VFR", "MVFR", "IFR", "LIFR"];

/**
 * FAA flight category from the ceiling (feet above ground; null = no ceiling)
 * and the visibility (statute miles), whichever is worse:
 *   LIFR  ceiling below 500 ft, or visibility below 1 SM
 *   IFR   ceiling 500 to below 1,000 ft, or visibility 1 to below 3 SM
 *   MVFR  ceiling 1,000 to 3,000 ft, or visibility 3 to 5 SM
 *   VFR   ceiling above 3,000 ft and visibility above 5 SM
 * Without a visibility there is no category (a report with its sensor out).
 */
export function flightCategory(ceilingFt: number | null, visibilitySm: number | null): FlightCategory | null {
  if (visibilitySm == null || !Number.isFinite(visibilitySm)) return null;
  const c = ceilingFt ?? Infinity;
  if (c < 500 || visibilitySm < 1) return "LIFR";
  if (c < 1000 || visibilitySm < 3) return "IFR";
  if (c <= 3000 || visibilitySm <= 5) return "MVFR";
  return "VFR";
}

// ── Groups shared by METARs and TAFs ─────────────────────────────────────────

export interface Wind {
  /** True direction the wind blows from; null when variable (VRB) or calm. */
  dirDeg: number | null;
  variable: boolean;
  speedKt: number;
  gustKt: number | null;
  /** "180V240": the direction varies between these. */
  varFromDeg: number | null;
  varToDeg: number | null;
}

export interface Visibility {
  /** Statute miles (metres are converted). */
  sm: number;
  /** "P6SM", 9999, CAVOK: more than this. */
  plus: boolean;
  /** "M1/4SM": less than this. */
  minus: boolean;
  /** Reported in metres (ICAO): the metres, else null. */
  meters: number | null;
}

export type CloudCover = "FEW" | "SCT" | "BKN" | "OVC" | "VV";

export interface CloudLayer {
  /** VV is vertical visibility into an obscured sky (fog, heavy snow): it counts as the ceiling. */
  cover: CloudCover;
  /** Feet above ground; null when the station couldn't measure it ("BKN///"). */
  baseFt: number | null;
  /** Cumulonimbus or towering cumulus. */
  type: "CB" | "TCU" | null;
}

export type WxIntensity = "light" | "heavy" | "vicinity";

/** One present-weather group, e.g. "-TSRA". */
export interface WxGroup {
  code: string;
  intensity: WxIntensity | null;
  /** MI, PR, BC, DR, BL, SH, TS or FZ. */
  descriptor: string | null;
  /** RA, SN, BR, FG… in the order given. */
  phenomena: string[];
}

export interface Conditions {
  wind: Wind | null;
  visibility: Visibility | null;
  weather: WxGroup[];
  clouds: CloudLayer[];
  /** SKC, CLR, NSC, NCD or CAVOK: the sky was reported, without clouds that matter. */
  skyClear: boolean;
  cavok: boolean;
}

const KT_PER_MPS = 1.943844;
const KT_PER_KMH = 0.539957;
const M_PER_SM = 1609.344;

const WIND = /^(\d{3}|VRB|\/{3})(\d{2,3}|\/\/)(?:G(\d{2,3}))?(KT|MPS|KMH)$/;
const WIND_VARIES = /^(\d{3})V(\d{3})$/;
const VIS_SM = /^([PM])?(?:(\d{1,2})|(\d{1,2})\/(\d{1,2}))SM$/;
const VIS_M = /^(\d{4})(NDV)?$/;
const CLOUD = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/{3})(CB|TCU|\/{3})?$/;
const CLEAR = /^(SKC|CLR|NSC|NCD)$/;
const DESCRIPTORS = ["MI", "PR", "BC", "DR", "BL", "SH", "TS", "FZ"];
const PHENOMENA = ["DZ", "RA", "SN", "SG", "IC", "PL", "GR", "GS", "UP", "BR", "FG", "FU", "VA", "DU", "SA", "HZ", "PY", "PO", "SQ", "FC", "SS", "DS"];
const WX = new RegExp(`^(\\+|-|VC)?(${DESCRIPTORS.join("|")})?((?:${PHENOMENA.join("|")})*)$`);

export function parseWind(token: string): Wind | null {
  const m = token.match(WIND);
  if (!m) return null;
  const factor = m[4] === "MPS" ? KT_PER_MPS : m[4] === "KMH" ? KT_PER_KMH : 1;
  const kt = (v: string) => Math.round(Number(v) * factor);
  const speed = m[2] === "//" ? 0 : kt(m[2]!);
  const variable = m[1] === "VRB";
  const dir = variable || m[1] === "///" ? null : Number(m[1]);
  return {
    // "00000KT" is calm: no direction.
    dirDeg: dir === 0 && speed === 0 ? null : dir,
    variable,
    speedKt: speed,
    gustKt: m[3] ? kt(m[3]) : null,
    varFromDeg: null,
    varToDeg: null,
  };
}

/** A visibility of one or two tokens ("1 1/2SM" is "1" then "1/2SM"). Returns it and how many tokens it used. */
export function parseVisibility(tokens: readonly string[], i: number): { vis: Visibility; used: number } | null {
  const a = tokens[i];
  if (!a) return null;
  // A whole number, then the fraction: "2 1/4SM".
  const b = tokens[i + 1];
  if (/^\d$/.test(a) && b) {
    const f = b.match(/^(\d)\/(\d{1,2})SM$/);
    if (f && Number(f[2]) > 0) return { vis: { sm: Number(a) + Number(f[1]) / Number(f[2]), plus: false, minus: false, meters: null }, used: 2 };
  }
  const sm = a.match(VIS_SM);
  if (sm) {
    const [, pm, whole, num, den] = sm;
    const value = whole != null ? Number(whole) : Number(num) / Number(den);
    if (!Number.isFinite(value)) return null;
    return { vis: { sm: value, plus: pm === "P", minus: pm === "M", meters: null }, used: 1 };
  }
  const m = a.match(VIS_M);
  if (m) {
    const meters = Number(m[1]);
    // 9999 means 10 km or more.
    return { vis: { sm: meters / M_PER_SM, plus: meters === 9999, minus: false, meters }, used: 1 };
  }
  return null;
}

export function parseCloud(token: string): CloudLayer | null {
  const m = token.match(CLOUD);
  if (!m) return null;
  return {
    cover: m[1] as CloudCover,
    baseFt: m[2] === "///" ? null : Number(m[2]) * 100,
    type: m[3] === "CB" || m[3] === "TCU" ? m[3] : null,
  };
}

export function parseWeather(token: string): WxGroup | null {
  const m = token.match(WX);
  if (!m) return null;
  const [, sign, descriptor, rest] = m;
  // "-" alone, or a sign with nothing after it, isn't weather.
  if (!descriptor && !rest) return null;
  const phenomena = rest ? (rest.match(/.{2}/g) ?? []) : [];
  return {
    code: token,
    intensity: sign === "-" ? "light" : sign === "+" ? "heavy" : sign === "VC" ? "vicinity" : null,
    descriptor: descriptor ?? null,
    phenomena,
  };
}

/** Lowest broken, overcast or vertical-visibility layer, in feet; null when there is none. */
export function ceilingOf(clouds: readonly CloudLayer[]): number | null {
  let low: number | null = null;
  for (const c of clouds) {
    if ((c.cover === "BKN" || c.cover === "OVC" || c.cover === "VV") && c.baseFt != null && (low == null || c.baseFt < low)) low = c.baseFt;
  }
  return low;
}

/** Category of decoded conditions. CAVOK means no cloud below 5,000 ft and at least 10 km. */
export function conditionsCategory(c: Pick<Conditions, "visibility" | "clouds">): FlightCategory | null {
  return flightCategory(ceilingOf(c.clouds), c.visibility?.sm ?? null);
}

/**
 * Reads the condition groups at `tokens[i]`. Returns how many tokens it used
 * (0 when the token isn't one of them).
 */
function readCondition(tokens: readonly string[], i: number, into: Conditions): number {
  const tok = tokens[i]!;
  const wind = parseWind(tok);
  if (wind) {
    into.wind = wind;
    return 1;
  }
  const varies = tok.match(WIND_VARIES);
  if (varies && into.wind) {
    into.wind.varFromDeg = Number(varies[1]);
    into.wind.varToDeg = Number(varies[2]);
    return 1;
  }
  if (tok === "CAVOK") {
    into.cavok = true;
    into.skyClear = true;
    into.visibility = { sm: 10_000 / M_PER_SM, plus: true, minus: false, meters: 9999 };
    return 1;
  }
  if (!into.visibility) {
    const vis = parseVisibility(tokens, i);
    if (vis) {
      into.visibility = vis.vis;
      return vis.used;
    }
  }
  const cloud = parseCloud(tok);
  if (cloud) {
    into.clouds.push(cloud);
    return 1;
  }
  if (CLEAR.test(tok)) {
    into.skyClear = true;
    return 1;
  }
  const wx = parseWeather(tok);
  if (wx) {
    into.weather.push(wx);
    return 1;
  }
  return 0;
}

const emptyConditions = (): Conditions => ({ wind: null, visibility: null, weather: [], clouds: [], skyClear: false, cavok: false });

// ── Times ────────────────────────────────────────────────────────────────────

/**
 * A day-of-month and time (UTC) as epoch ms: the one closest to `ref`, so a
 * report from the 31st read on the 1st lands in the previous month. Hour 24
 * is midnight at the end of the day (TAF validity "2124").
 */
export function resolveDayTime(day: number, hour: number, minute: number, ref: number): number | null {
  if (day < 1 || day > 31 || hour > 24 || minute > 59) return null;
  const r = new Date(ref);
  let best: number | null = null;
  for (const dm of [-1, 0, 1]) {
    const y = r.getUTCFullYear();
    const mo = r.getUTCMonth() + dm;
    // A day the month doesn't have (the 31st of November) would roll into the next one.
    const daysIn = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    if (day > daysIn) continue;
    const t = Date.UTC(y, mo, day, hour, minute);
    if (best == null || Math.abs(t - ref) < Math.abs(best - ref)) best = t;
  }
  return best;
}

const DAY_TIME = /^(\d{2})(\d{2})(\d{2})Z$/;
const parseIssue = (tok: string, ref: number) => {
  const m = tok.match(DAY_TIME);
  return m ? resolveDayTime(+m[1]!, +m[2]!, +m[3]!, ref) : null;
};

// ── METAR ────────────────────────────────────────────────────────────────────

export interface Metar extends Conditions {
  raw: string;
  station: string;
  type: "METAR" | "SPECI";
  /** Observation time (epoch ms), or null when the report has none. */
  time: number | null;
  /** From an automated station (AUTO). */
  auto: boolean;
  corrected: boolean;
  tempC: number | null;
  dewpointC: number | null;
  /** As reported: A2992 is 29.92 inHg, Q1013 is 1013 hPa. */
  altimeter: { value: number; unit: "inHg" | "hPa" } | null;
  ceilingFt: number | null;
  category: FlightCategory | null;
  /** Everything from RMK on, as sent. */
  remarks: string | null;
  /** Groups before the remarks that weren't understood (runway visual range, trends…). */
  unparsed: string[];
}

const STATION = /^[A-Z][A-Z0-9]{3}$/;
const TEMP = /^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)?$/;
const signedTemp = (s: string | undefined) => (s && s !== "//" ? (s.startsWith("M") ? -Number(s.slice(1)) : Number(s)) : null);
/** Runway visual range, e.g. R28L/2400FT or R09/0600V1000U: skipped quietly. */
const RVR = /^R\d{2}[LCR]?\/[PM]?\d{4}(?:V[PM]?\d{4})?(?:FT)?(?:\/?[UDN])?$/;

/** Decodes one METAR or SPECI. `ref` is a time near the report, to place its day in a month. */
export function decodeMetar(raw: string, ref = Date.now()): Metar | null {
  const text = raw.trim().replace(/=$/, "");
  const rmk = text.search(/\sRMK(\s|$)/);
  const body = rmk >= 0 ? text.slice(0, rmk) : text;
  const tokens = body.split(/\s+/).filter(Boolean);
  let i = 0;
  let type: Metar["type"] = "METAR";
  if (tokens[i] === "METAR" || tokens[i] === "SPECI") type = tokens[i++] as Metar["type"];
  if (tokens[i] === "COR") i++;
  const station = tokens[i];
  if (!station || !STATION.test(station)) return null;
  i++;
  const out: Metar = {
    raw: text,
    station,
    type,
    time: null,
    auto: false,
    corrected: /\bCOR\b/.test(body),
    ...emptyConditions(),
    tempC: null,
    dewpointC: null,
    altimeter: null,
    ceilingFt: null,
    category: null,
    remarks: rmk >= 0 ? text.slice(rmk + 1).trim() : null,
    unparsed: [],
  };
  if (tokens[i] && DAY_TIME.test(tokens[i]!)) out.time = parseIssue(tokens[i++]!, ref);
  for (; i < tokens.length; i++) {
    const tok = tokens[i]!;
    // Trend forecasts on ICAO reports (NOSIG, BECMG…, TEMPO…) aren't the observation.
    if (tok === "NOSIG" || tok === "BECMG" || tok === "TEMPO") break;
    if (tok === "AUTO" || tok === "COR") {
      if (tok === "AUTO") out.auto = true;
      continue;
    }
    const temp = tok.match(TEMP);
    if (temp && (temp[1] !== "//" || temp[2])) {
      out.tempC = signedTemp(temp[1]);
      out.dewpointC = signedTemp(temp[2]);
      continue;
    }
    const alt = tok.match(/^([AQ])(\d{4})$/);
    if (alt) {
      out.altimeter = alt[1] === "A" ? { value: Number(alt[2]) / 100, unit: "inHg" } : { value: Number(alt[2]), unit: "hPa" };
      continue;
    }
    const used = readCondition(tokens, i, out);
    if (used) {
      i += used - 1;
      continue;
    }
    if (!RVR.test(tok) && !/^\/+$/.test(tok)) out.unparsed.push(tok);
  }
  out.ceilingFt = ceilingOf(out.clouds);
  out.category = conditionsCategory(out);
  return out;
}

// ── TAF ──────────────────────────────────────────────────────────────────────

export type TafChange = "base" | "from" | "becoming" | "temporary" | "probability";

export interface TafPeriod extends Conditions {
  /** base: the first forecast; from: FM, a new forecast from then on; becoming: BECMG, a gradual change; temporary: TEMPO; probability: PROB30/40 (with or without TEMPO). */
  change: TafChange;
  /** PROB30 → 30. */
  probability: number | null;
  /** TEMPO under a PROB group ("PROB30 TEMPO"). */
  temporary: boolean;
  /** Epoch ms. FM periods end where the next FM (or the TAF) does. */
  from: number;
  to: number;
  /** Low-level wind shear: WS020/24045KT. */
  windShear: { heightFt: number; dirDeg: number; speedKt: number } | null;
  /** NSW: the weather in the previous period ends. */
  noSignificantWeather: boolean;
  /**
   * The category the period forecasts. TEMPO, PROB and BECMG groups only give
   * what changes, so the rest comes from the forecast they belong to.
   */
  category: FlightCategory | null;
  ceilingFt: number | null;
  raw: string;
}

export interface Taf {
  raw: string;
  station: string;
  amended: boolean;
  corrected: boolean;
  /** Issue time (epoch ms), when given. */
  issued: number | null;
  from: number;
  to: number;
  periods: TafPeriod[];
  remarks: string | null;
}

const VALID = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/;
const FM = /^FM(\d{2})(\d{2})(\d{2})$/;
const PROB = /^PROB(\d{2})$/;
const WIND_SHEAR = /^WS(\d{3})\/(\d{3})(\d{2,3})KT$/;

function validity(tok: string | undefined, ref: number): [number, number] | null {
  const m = tok?.match(VALID);
  if (!m) return null;
  const from = resolveDayTime(+m[1]!, +m[2]!, 0, ref);
  if (from == null) return null;
  // The end is after the start: resolve it against the start, not the reference.
  const to = resolveDayTime(+m[3]!, +m[4]!, 0, from + 15 * 3_600_000);
  return to != null && to > from ? [from, to] : null;
}

/** Decodes one TAF. `ref` is a time near its issue (the issue time itself, or now). */
export function decodeTaf(raw: string, ref = Date.now()): Taf | null {
  const text = raw.trim().replace(/=$/, "");
  const rmk = text.search(/\sRMK(\s|$)/);
  const body = rmk >= 0 ? text.slice(0, rmk) : text;
  const tokens = body.split(/\s+/).filter(Boolean);
  let i = 0;
  if (tokens[i] === "TAF") i++;
  let amended = false;
  let corrected = false;
  for (; tokens[i] === "AMD" || tokens[i] === "COR"; i++) {
    if (tokens[i] === "AMD") amended = true;
    else corrected = true;
  }
  const station = tokens[i];
  if (!station || !STATION.test(station)) return null;
  i++;
  let issued: number | null = null;
  if (tokens[i] && DAY_TIME.test(tokens[i]!)) issued = parseIssue(tokens[i++]!, ref);
  const valid = validity(tokens[i], issued ?? ref);
  if (!valid) return null;
  i++;
  const [tafFrom, tafTo] = valid;
  const timeRef = issued ?? tafFrom;

  const periods: TafPeriod[] = [];
  let current: TafPeriod = newPeriod("base", tafFrom, tafTo);
  let start = i;
  const finish = (end: number) => {
    current.raw = tokens.slice(start, end).join(" ");
    periods.push(current);
  };

  for (; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const fm = tok.match(FM);
    const prob = tok.match(PROB);
    if (fm || prob || tok === "TEMPO" || tok === "BECMG") {
      finish(i);
      start = i;
      if (fm) {
        const at = resolveDayTime(+fm[1]!, +fm[2]!, +fm[3]!, timeRef) ?? tafFrom;
        current = newPeriod("from", at, tafTo);
        continue;
      }
      const change: TafChange = tok === "TEMPO" ? "temporary" : tok === "BECMG" ? "becoming" : "probability";
      let probability: number | null = null;
      let temporary = change === "temporary";
      if (prob) {
        probability = Number(prob[1]);
        if (tokens[i + 1] === "TEMPO") {
          temporary = true;
          i++;
        }
      }
      // A change group without its times (rare) spans the TAF.
      const span = validity(tokens[i + 1], timeRef);
      if (span) i++;
      current = newPeriod(change, span?.[0] ?? tafFrom, span?.[1] ?? tafTo);
      current.probability = probability;
      current.temporary = temporary;
      continue;
    }
    const ws = tok.match(WIND_SHEAR);
    if (ws) {
      current.windShear = { heightFt: Number(ws[1]) * 100, dirDeg: Number(ws[2]), speedKt: Number(ws[3]) };
      continue;
    }
    if (tok === "NSW") {
      current.noSignificantWeather = true;
      continue;
    }
    const used = readCondition(tokens, i, current);
    if (used) i += used - 1;
  }
  finish(tokens.length);

  // FM periods run until the next one; then the categories, with what changes laid over the forecast it belongs to.
  const main = periods.filter((p) => p.change === "base" || p.change === "from");
  main.forEach((p, k) => (p.to = main[k + 1]?.from ?? tafTo));
  for (const p of periods) {
    const base = p.change === "base" || p.change === "from" ? p : prevailingAt(main, p.from);
    const clouds = p.clouds.length || p.skyClear ? p.clouds : (base?.clouds ?? []);
    const visibility = p.visibility ?? base?.visibility ?? null;
    p.ceilingFt = ceilingOf(clouds);
    p.category = flightCategory(p.ceilingFt, visibility?.sm ?? null);
  }
  return { raw: text, station, amended, corrected, issued, from: tafFrom, to: tafTo, periods, remarks: rmk >= 0 ? text.slice(rmk + 1).trim() : null };
}

function newPeriod(change: TafChange, from: number, to: number): TafPeriod {
  return {
    change,
    probability: null,
    temporary: change === "temporary",
    from,
    to,
    ...emptyConditions(),
    windShear: null,
    noSignificantWeather: false,
    category: null,
    ceilingFt: null,
    raw: "",
  };
}

/** The base or FM forecast in effect at `t`. */
function prevailingAt(main: readonly TafPeriod[], t: number): TafPeriod | undefined {
  let found = main[0];
  for (const p of main) if (p.from <= t) found = p;
  return found;
}

/** The TAF period forecast for `t` (the base/FM one; changes are listed with it). */
export function tafPeriodAt(taf: Taf, t: number): TafPeriod | undefined {
  return prevailingAt(
    taf.periods.filter((p) => p.change === "base" || p.change === "from"),
    t,
  );
}

// ── Words ────────────────────────────────────────────────────────────────────

/** Present-weather names (English keys, translated by the caller's `t`). */
export const WX_NAMES: Record<string, string> = {
  DZ: "Drizzle",
  RA: "Rain",
  SN: "Snow",
  SG: "Snow grains",
  IC: "Ice crystals",
  PL: "Ice pellets",
  GR: "Hail",
  GS: "Small hail",
  UP: "Unknown precipitation",
  BR: "Mist",
  FG: "Fog",
  FU: "Smoke",
  VA: "Volcanic ash",
  DU: "Dust",
  SA: "Sand",
  HZ: "Haze",
  PY: "Spray",
  PO: "Dust whirls",
  SQ: "Squalls",
  FC: "Funnel cloud",
  SS: "Sandstorm",
  DS: "Duststorm",
};

/** How a descriptor wraps the weather it describes. */
const DESCRIPTOR_TEMPLATE: Record<string, string> = {
  MI: "Shallow {wx}",
  PR: "Partial {wx}",
  BC: "Patches of {wx}",
  DR: "Drifting {wx}",
  BL: "Blowing {wx}",
  SH: "{wx} showers",
  TS: "Thunderstorm with {wx}",
  FZ: "Freezing {wx}",
};
const DESCRIPTOR_ALONE: Record<string, string> = { TS: "Thunderstorm", SH: "Showers" };
const INTENSITY_TEMPLATE: Record<WxIntensity, string> = { light: "Light {wx}", heavy: "Heavy {wx}", vicinity: "{wx} nearby" };

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "-TSRA" → "Thunderstorm with light rain", "+FC" → "Tornado or waterspout", "VCSH" → "Showers nearby". */
export function weatherText(w: WxGroup, t: Translator = translator("en")): string {
  if (w.intensity === "heavy" && w.phenomena.length === 1 && w.phenomena[0] === "FC" && !w.descriptor) return t("Tornado or waterspout");
  const names = w.phenomena.map((p) => t(WX_NAMES[p] ?? p));
  let wx = names.length ? names.reduce((a, b) => t("{a} and {b}", { a, b: lowerFirst(b) })) : "";
  const intensity = w.intensity ? INTENSITY_TEMPLATE[w.intensity] : null;
  // A thunderstorm's intensity is its rain's: "-TSRA" is a thunderstorm with light rain.
  if (w.descriptor === "TS" && wx && intensity && w.intensity !== "vicinity") {
    return upperFirst(t(DESCRIPTOR_TEMPLATE.TS!, { wx: lowerFirst(t(intensity, { wx: lowerFirst(wx) })) }));
  }
  if (w.descriptor) wx = wx ? t(DESCRIPTOR_TEMPLATE[w.descriptor]!, { wx: lowerFirst(wx) }) : t(DESCRIPTOR_ALONE[w.descriptor] ?? w.descriptor);
  if (intensity && wx) wx = t(intensity, { wx: lowerFirst(wx) });
  return upperFirst(wx || w.code);
}

export const COVER_NAMES: Record<CloudCover, string> = { FEW: "Few", SCT: "Scattered", BKN: "Broken", OVC: "Overcast", VV: "Vertical visibility" };

/** 1.5 → "1 1/2", 0.25 → "1/4", 10 → "10": statute miles as pilots write them. */
export function formatSm(sm: number): string {
  const whole = Math.floor(sm + 1e-9);
  const frac = sm - whole;
  if (frac < 1e-6) return String(whole);
  for (const den of [2, 4, 8, 16]) {
    const num = Math.round(frac * den);
    if (Math.abs(num / den - frac) < 1e-6) {
      const f = `${num}/${den}`;
      return whole ? `${whole} ${f}` : f;
    }
  }
  return String(Math.round(sm * 10) / 10);
}
