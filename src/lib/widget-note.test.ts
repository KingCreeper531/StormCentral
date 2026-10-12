import { describe, expect, it } from "vitest";
import type { Forecast } from "./api/open-meteo";
import { carryNote, type WidgetSnapshot } from "./alerting/engine";
import type { ClimateTable } from "./climate";
import { slotOf } from "./climate";
import type { ForecasterNotesResponse } from "./feeds/forecaster-notes";
import { widgetNote } from "./widget-note";

const NOW = Date.UTC(2026, 9, 12, 17); // noon in Chicago
const T0 = Date.UTC(2026, 9, 12, 5) / 1000; // local midnight

function forecast(hiC: number, loC: number): Forecast {
  return { timezone: "America/Chicago", utcOffsetSeconds: -5 * 3600, daily: { time: [T0, T0 + 86_400], tMax: [hiC, 20], tMin: [loC, 10] } } as unknown as Forecast;
}
function climate(recHi: number, recLo: number, normalHi = 20): ClimateTable {
  const fill = (v: number | null) => new Array(366).fill(v);
  const c = { hi: fill(normalHi), lo: fill(5), precip: fill(1), recHi: fill(null), recHiYear: fill(null), recLo: fill(null), recLoYear: fill(null) } as unknown as ClimateTable;
  const s = slotOf("2026-10-12");
  c.recHi[s] = recHi;
  c.recHiYear[s] = 1938;
  c.recLo[s] = recLo;
  c.recLoYear[s] = 1988;
  return c;
}
const notes = (issuedMs: number) => ({ issued: new Date(issuedMs).toISOString(), summary: { kind: "key-messages", items: ["Unseasonably warm on Tuesday; near record high temperatures. Rain chances on Wednesday."] } }) as ForecasterNotesResponse;

describe("widgetNote", () => {
  it("calls out a near-record or record high first", () => {
    expect(widgetNote(forecast(29, 10), climate(29.4, -5), notes(NOW), "F", NOW)).toEqual({
      text: "Near-record high: 84° (record 85°, 1938)",
      until: new Date((T0 + 86_400) * 1000).toISOString(),
    });
    expect(widgetNote(forecast(31, 10), climate(29.4, -5), null, "C", NOW)?.text).toBe("Record high possible: 31° (record 29°, 1938)");
    expect(widgetNote(forecast(15, -4.6), climate(29.4, -5), null, "F", NOW)?.text).toBe("Near-record low: 24° (record 23°, 1988)");
    expect(widgetNote(forecast(15, -6), climate(29.4, -5), null, "F", NOW)?.text).toBe("Record low possible: 21° (record 23°, 1988)");
  });

  it("falls back to the forecasters' first key message, shortened", () => {
    const n = widgetNote(forecast(20, 10), climate(29.4, -5), notes(NOW - 3_600_000), "F", NOW);
    expect(n?.text).toBe("Unseasonably warm on Tuesday; near record high temperatures");
    // Old discussions are ignored.
    expect(widgetNote(forecast(20, 10), climate(29.4, -5), notes(NOW - 20 * 3_600_000), "F", NOW)).toBeNull();
  });

  it("notes a day far from normal when nothing else applies", () => {
    expect(widgetNote(forecast(30, 10), climate(40, -5, 20), null, "F", NOW)?.text).toBe("Much warmer than normal: 18° above");
    expect(widgetNote(null, null, null, "F", NOW)).toBeNull();
  });
});

describe("carryNote", () => {
  const prev = { place: { name: "A", lat: 35.2, lon: -97.4 }, note: { text: "x", until: new Date(NOW + 3_600_000).toISOString() } } as WidgetSnapshot;
  it("keeps the app's note for the same place until it expires", () => {
    expect(carryNote(prev, { lat: 35.2, lon: -97.4 }, NOW)?.text).toBe("x");
    expect(carryNote(prev, { lat: 36, lon: -97.4 }, NOW)).toBeNull();
    expect(carryNote(prev, { lat: 35.2, lon: -97.4 }, NOW + 2 * 3_600_000)).toBeNull();
    expect(carryNote(null, { lat: 0, lon: 0 }, NOW)).toBeNull();
  });
});
