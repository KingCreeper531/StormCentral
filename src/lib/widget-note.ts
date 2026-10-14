/**
 * The one-line highlight home-screen widgets show when they have room: a
 * near-record temperature from the official records, otherwise the local
 * forecasters' first key message, otherwise an unusually warm or cold day.
 */
import type { Forecast } from "./api/open-meteo";
import type { ClimateTable } from "./climate";
import { isoDateIn, slotOf } from "./climate";
import type { ForecasterNotesResponse } from "./feeds/forecaster-notes";
import { translator, type Translator } from "./i18n/core";
import { todayIndex } from "./weather/view";

export interface WidgetNote {
  text: string;
  /** ISO instant after which the note is stale. */
  until: string;
}

const MAX_LEN = 90;

/** "84°": the unit is implied on a widget that already shows temperatures. */
const deg = (c: number, unit: "F" | "C") => `${Math.round(unit === "F" ? (c * 9) / 5 + 32 : c)}°`;

/** First sentence, trimmed to fit a widget line. */
function shorten(s: string): string {
  const sentence = s.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? s;
  const t = sentence.replace(/\s+/g, " ").trim().replace(/[.!]$/, "");
  return t.length <= MAX_LEN ? t : `${t.slice(0, MAX_LEN - 1).replace(/\s+\S*$/, "")}…`;
}

export function widgetNote(
  f: Forecast | null,
  climate: ClimateTable | null,
  notes: ForecasterNotesResponse | null,
  unit: "F" | "C",
  nowMs: number,
  /** The person's language; the forecasters' own words stay as written. */
  t: Translator = translator("en"),
): WidgetNote | null {
  const di = f ? todayIndex(f, nowMs) : -1;
  // Today ends at the next local midnight.
  const endOfDay = f && di >= 0 && f.daily.time[di + 1] != null ? new Date(f.daily.time[di + 1]! * 1000).toISOString() : new Date(nowMs + 12 * 3_600_000).toISOString();

  if (f && climate && di >= 0) {
    const s = slotOf(isoDateIn(nowMs, f.timezone));
    const hi = f.daily.tMax[di];
    const lo = f.daily.tMin[di];
    const recHi = climate.recHi[s];
    const recLo = climate.recLo[s];
    // "84°, 1998": the record and its year.
    const record = (c: number, y: number | null | undefined) => `${deg(c, unit)}${y ? `, ${y}` : ""}`;
    if (hi != null && recHi != null && hi >= recHi - 1) {
      const vars = { temp: deg(hi, unit), record: record(recHi, climate.recHiYear[s]) };
      return {
        text: hi > recHi ? t("Record high possible: {temp} (record {record})", vars) : t("Near-record high: {temp} (record {record})", vars),
        until: endOfDay,
      };
    }
    if (lo != null && recLo != null && lo <= recLo + 1) {
      const vars = { temp: deg(lo, unit), record: record(recLo, climate.recLoYear[s]) };
      return {
        text: lo < recLo ? t("Record low possible: {temp} (record {record})", vars) : t("Near-record low: {temp} (record {record})", vars),
        until: endOfDay,
      };
    }
  }

  const issued = notes ? Date.parse(notes.issued) : Number.NaN;
  const first = notes?.summary?.items[0];
  if (first && Number.isFinite(issued) && nowMs - issued < 18 * 3_600_000) {
    return { text: shorten(first), until: new Date(issued + 18 * 3_600_000).toISOString() };
  }

  if (f && climate && di >= 0) {
    const hi = f.daily.tMax[di];
    const normal = climate.hi[slotOf(isoDateIn(nowMs, f.timezone))];
    if (hi != null && normal != null && Math.abs(hi - normal) >= 8) {
      const d = Math.round(unit === "F" ? (Math.abs(hi - normal) * 9) / 5 : Math.abs(hi - normal));
      return { text: hi > normal ? t("Much warmer than normal: {d}° above", { d }) : t("Much colder than normal: {d}° below", { d }), until: endOfDay };
    }
  }
  return null;
}
