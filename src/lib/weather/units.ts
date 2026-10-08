/**
 * All weather data is stored in SI (°C, m/s, hPa, mm, m). Conversion happens
 * only at the presentation edge, so switching units never refetches data.
 */
export type TempUnit = "F" | "C";
export type WindUnit = "mph" | "kmh" | "ms" | "kn";
export type PressureUnit = "inHg" | "hPa";
export type DistanceUnit = "mi" | "km";
export type PrecipUnit = "in" | "mm";
export type HeightUnit = "ft" | "m";

export interface UnitPrefs {
  temp: TempUnit;
  wind: WindUnit;
  pressure: PressureUnit;
  distance: DistanceUnit;
  precip: PrecipUnit;
  height: HeightUnit;
}

export const UNIT_PRESETS = {
  imperial: { temp: "F", wind: "mph", pressure: "inHg", distance: "mi", precip: "in", height: "ft" },
  metric: { temp: "C", wind: "kmh", pressure: "hPa", distance: "km", precip: "mm", height: "m" },
} as const satisfies Record<string, UnitPrefs>;

const IMPERIAL_REGIONS = new Set(["US", "LR", "MM", "PR", "GU", "VI", "AS", "MP", "UM"]);
/** US time zones, for browsers that report a language without a region ("en"). */
const US_ZONE = /^(America\/(New_York|Detroit|Chicago|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Nome|Yakutat|Metlakatla|Adak|Menominee|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)|Pacific\/Honolulu|US\/.+)$/;

/**
 * First-run units: imperial in the US (and Liberia, Myanmar), metric elsewhere.
 * Takes the first locale that names a region; with none, falls back to the time zone.
 */
export function defaultUnitsForLocale(locales: string | readonly string[] | undefined, timeZone?: string): UnitPrefs {
  const list = typeof locales === "string" ? [locales] : (locales ?? []);
  const region = list.map((l) => l.split(/[-_]/)[1]?.toUpperCase()).find((r) => r && /^[A-Z]{2}$/.test(r));
  const imperial = region ? IMPERIAL_REGIONS.has(region) : !!timeZone && US_ZONE.test(timeZone);
  return { ...(imperial ? UNIT_PRESETS.imperial : UNIT_PRESETS.metric) };
}

export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;

export function convertTemp(c: number, unit: TempUnit) {
  return unit === "F" ? cToF(c) : c;
}

export function convertWind(ms: number, unit: WindUnit) {
  switch (unit) {
    case "mph":
      return ms * 2.236936;
    case "kmh":
      return ms * 3.6;
    case "kn":
      return ms * 1.943844;
    default:
      return ms;
  }
}

export function convertPressure(hPa: number, unit: PressureUnit) {
  return unit === "inHg" ? hPa * 0.0295299830714 : hPa;
}

export function convertDistanceKm(km: number, unit: DistanceUnit) {
  return unit === "mi" ? km * 0.621371 : km;
}

export function convertPrecip(mm: number, unit: PrecipUnit) {
  return unit === "in" ? mm / 25.4 : mm;
}

export function convertHeight(m: number, unit: HeightUnit) {
  return unit === "ft" ? m * 3.28084 : m;
}

export const WIND_LABEL: Record<WindUnit, string> = { mph: "mph", kmh: "km/h", ms: "m/s", kn: "kn" };
export const PRESSURE_LABEL: Record<PressureUnit, string> = { inHg: "inHg", hPa: "hPa" };

const nf = (digits: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const NF0 = nf(0);
const NF1 = nf(1);
const NF2 = nf(2);

function fmt(v: number, digits: 0 | 1 | 2) {
  if (!Number.isFinite(v)) return "—";
  // Avoid "-0" for tiny negatives after rounding.
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return (digits === 0 ? NF0 : digits === 1 ? NF1 : NF2).format(Object.is(r, -0) ? 0 : r);
}

// Number and unit are joined with a no-break space so "43 mph" never wraps apart.
export const formatters = (u: UnitPrefs) => ({
  temp: (c: number | null | undefined, withUnit = false) =>
    c == null ? "—" : `${fmt(convertTemp(c, u.temp), 0)}°${withUnit ? u.temp : ""}`,
  wind: (ms: number | null | undefined, withUnit = true) =>
    ms == null ? "—" : `${fmt(convertWind(ms, u.wind), u.wind === "ms" ? 1 : 0)}${withUnit ? `\u00a0${WIND_LABEL[u.wind]}` : ""}`,
  pressure: (hPa: number | null | undefined, withUnit = true) =>
    hPa == null ? "—" : `${fmt(convertPressure(hPa, u.pressure), u.pressure === "inHg" ? 2 : 0)}${withUnit ? `\u00a0${u.pressure}` : ""}`,
  /** Pressure change (hPa) — more precision than absolute pressure. */
  pressureDelta: (hPa: number | null | undefined) => {
    if (hPa == null || !Number.isFinite(hPa)) return "—";
    const v = convertPressure(hPa, u.pressure);
    const s = fmt(Math.abs(v), u.pressure === "inHg" ? 2 : 1);
    return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${s}\u00a0${u.pressure}`;
  },
  distanceKm: (km: number | null | undefined, withUnit = true) =>
    km == null ? "—" : `${fmt(convertDistanceKm(km, u.distance), km < 10 ? 1 : 0)}${withUnit ? `\u00a0${u.distance}` : ""}`,
  precip: (mm: number | null | undefined, withUnit = true) =>
    mm == null ? "—" : `${fmt(convertPrecip(mm, u.precip), u.precip === "in" ? 2 : 1)}${withUnit ? `\u00a0${u.precip}` : ""}`,
  height: (m: number | null | undefined, withUnit = true) =>
    m == null ? "—" : `${fmt(convertHeight(m, u.height), 0)}${withUnit ? `\u00a0${u.height}` : ""}`,
  visibility: (m: number | null | undefined) => {
    if (m == null) return "—";
    const km = m / 1000;
    return u.distance === "mi" ? `${fmt(Math.min(km * 0.621371, 10), 1)}\u00a0mi` : `${fmt(Math.min(km, 16), 1)}\u00a0km`;
  },
  percent: (p: number | null | undefined) => (p == null ? "—" : `${fmt(p, 0)}%`),
});

export type Formatters = ReturnType<typeof formatters>;
