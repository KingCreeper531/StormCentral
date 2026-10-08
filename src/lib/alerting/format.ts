/**
 * Formatting for notification text. Deliberately free of Intl and the DOM:
 * it also runs in the Android background runner, whose JavaScript engine
 * provides neither.
 */
import type { TempUnit, WindUnit } from "../weather/units";

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "3 PM" / "3:30 PM" for an epoch time at a fixed UTC offset (seconds). */
export function clockAt(epochMs: number, utcOffsetSec: number): string {
  const d = new Date(epochMs + utcOffsetSec * 1000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${pad(m)}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** Calendar day ("2026-10-07") of an epoch time at a fixed UTC offset. */
export function dayKeyAt(epochMs: number, utcOffsetSec: number): string {
  const d = new Date(epochMs + utcOffsetSec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Clock time from an ISO timestamp with its own offset ("2026-10-07T15:12:00-05:00"),
 * shown in that offset: NWS alert times carry the issuing office's local offset.
 */
export function clockFromIso(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  const ms = Date.parse(iso);
  const off = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (m && off) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    return `${h % 12 === 0 ? 12 : h % 12}${min ? `:${m[2]}` : ""} ${h < 12 ? "AM" : "PM"}`;
  }
  return Number.isFinite(ms) ? clockAt(ms, 0) + " UTC" : iso;
}

export function formatTemp(c: number, unit: TempUnit): string {
  return unit === "F" ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`;
}

export function convertWindMs(ms: number, unit: WindUnit): number {
  return unit === "mph" ? ms * 2.236936 : unit === "kmh" ? ms * 3.6 : unit === "kn" ? ms * 1.943844 : ms;
}

export function windToMs(v: number, unit: WindUnit): number {
  return v / convertWindMs(1, unit);
}

export const WIND_LABEL: Record<WindUnit, string> = { mph: "mph", kmh: "km/h", ms: "m/s", kn: "kt" };

export function formatWind(ms: number, unit: WindUnit): string {
  return `${Math.round(convertWindMs(ms, unit))} ${WIND_LABEL[unit]}`;
}

/** Stable positive 31-bit id for a string (notification ids must be int32). */
export function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}
