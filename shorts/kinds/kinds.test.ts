import { describe, expect, it } from "vitest";
import type { StormReport } from "../../src/lib/feeds/storm-reports";
import type { TropicalStorm } from "../../src/lib/feeds/tropical";
import { parseOutlook } from "../spc-outlook";
import { descriptionForEs, titleForEs, type GeoCollection } from "../meta";
import { dayStart, isActive, recapDescription, recapEs, recapTitle, severeReports, summarize } from "./recap";
import { fireName, fireText, growthSince, parseFires, pickFires } from "./fire";
import { compass, peakAhead, pickStorms, stageName, toKmh, toMph, tropicalText, upcoming, zoneOf } from "./tropical";
import { busiest, catDay, dayRisk, probDay, weeklyText, type WeekDay } from "./weekly";

const report = (over: Partial<StormReport>): StormReport => ({
  id: Math.random().toString(36),
  time: "2026-10-13T22:00:00Z",
  kind: "hail",
  typeText: "HAIL",
  magnitude: 1,
  unit: "INCH",
  measured: null,
  place: "3 NW Amarillo",
  county: null,
  state: "TX",
  source: null,
  remark: null,
  wfo: null,
  lat: 35.2,
  lon: -101.8,
  ...over,
});

describe("storm report recap", () => {
  const reports = severeReports([
    report({ kind: "tornado", typeText: "TORNADO", magnitude: null, state: "OK", place: "2 S NORMAN", time: "2026-10-13T23:10:00Z" }),
    report({ magnitude: 2.75, place: "5 E LUBBOCK", time: "2026-10-13T21:00:00Z" }),
    report({ magnitude: 0.75 }), // below severe
    report({ kind: "wind", typeText: "TSTM WND GST", magnitude: 70, unit: "MPH", state: "OK", place: "TULSA" }),
    report({ kind: "wind", typeText: "TSTM WND GST", magnitude: 45, unit: "MPH" }), // below severe
    report({ kind: "wind-damage", typeText: "TSTM WND DMG", magnitude: null, unit: null, state: "KS" }),
    report({ kind: "wind", typeText: "MARINE TSTM WIND", magnitude: 60, unit: "KNOTS" }), // marine
    report({ kind: "wind", typeText: "NON-TSTM WND GST", magnitude: 65, unit: "MPH" }), // not a storm
    report({ magnitude: 65, place: "3 W GOODLETT" }), // a gust filed as hail
  ]);
  const s = summarize(reports);

  it("keeps only severe reports over land, oldest first", () => {
    expect(reports.map((r) => r.kind)).toEqual(["hail", "wind", "wind", "tornado"]);
    expect(reports[0]!.place).toBe("Lubbock, TX");
    expect(reports.at(-1)!.place).toBe("Norman, OK");
  });

  it("counts by kind and state, and finds the biggest hail and gust", () => {
    expect(s.counts).toEqual({ tornado: 1, wind: 2, hail: 1 });
    expect(s.total).toBe(4);
    expect(s.states[0]).toBe("OK");
    expect(s.tornadoStates).toEqual(["OK"]);
    expect(s.hail?.magnitude).toBe(2.75);
    expect(s.wind?.magnitude).toBe(70);
  });

  it("is an active day with any tornado report, or 15 severe reports", () => {
    expect(isActive(s)).toBe(true);
    const hailOnly = summarize(severeReports(Array.from({ length: 14 }, () => report({}))));
    expect(isActive(hailOnly)).toBe(false);
    expect(isActive(summarize(severeReports(Array.from({ length: 15 }, () => report({})))))).toBe(true);
  });

  it("recaps the convective day that started at 7 AM Central", () => {
    // 03:15Z on the 14th is the evening of the 13th.
    expect(new Date(dayStart(Date.parse("2026-10-14T03:15:00Z"))).toISOString()).toBe("2026-10-13T12:00:00.000Z");
    expect(new Date(dayStart(Date.parse("2026-10-13T23:00:00Z"))).toISOString()).toBe("2026-10-13T12:00:00.000Z");
  });

  it("writes the title and descriptions in English and Spanish", () => {
    const day = Date.parse("2026-10-13T12:00:00Z");
    expect(recapTitle(s, day)).toBe("Severe Weather Reports, Tue, Oct 13: 1 Tornado Report, Hail to 2.75 in #shorts");
    const d = recapDescription(s);
    expect(d).toContain("1 tornado report, 2 damaging wind reports and 1 large hail report, most of them in OK, TX and KS.");
    expect(d).toContain("Largest hail: 2.75 in near Lubbock, TX.");
    expect(d).toContain("Strongest gust: 70 mph near Tulsa, OK.");
    expect(d).toContain("not an official warning system");
    const es = recapEs(s, day);
    expect(es.title).toMatch(/^Reportes de clima severo, mar,? 13 de oct\.?: 1 reporte de tornado, granizo de hasta 7 cm #shorts$/);
    expect(es.description).toContain("Ráfaga más fuerte: 70 mph (113 km/h) cerca de Tulsa, OK.");
    expect(es.description).toContain("no es un sistema oficial de alertas");
    for (const t of [recapTitle(s, day), es.title]) expect(t.length).toBeLessThanOrEqual(100);
  });
});

const area = (LABEL: string, VALID = "202610181200"): GeoCollection["features"][number] => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [] },
  properties: { LABEL, VALID },
});

describe("week ahead", () => {
  const D1 = Date.parse("2026-10-18T12:00:00Z");
  const days: WeekDay[] = [
    catDay({ type: "FeatureCollection", features: [area("TSTM"), area("MRGL")] }, 1, D1),
    catDay({ type: "FeatureCollection", features: [area("TSTM", "202610191200"), area("MRGL", "202610191200"), area("SLGT", "202610191200"), area("ENH", "202610191200")] }, 2, D1 + 86_400_000),
    catDay({ type: "FeatureCollection", features: [] }, 3, D1 + 2 * 86_400_000),
    probDay({ type: "FeatureCollection", features: [area("0.15", "202610211200")] }, 4, D1 + 3 * 86_400_000),
    probDay({ type: "FeatureCollection", features: [area("Potential Too Low", "202610221200")] }, 5, D1 + 4 * 86_400_000),
    ...[6, 7, 8].map((n) => probDay({ type: "FeatureCollection", features: [area("Predictability Too Low", "")] }, n, D1 + (n - 1) * 86_400_000)),
  ];

  it("reads each day's highest risk or probability", () => {
    expect(days.map((d) => d.code ?? d.prob)).toEqual(["MRGL", "ENH", 0, 15, 0, 0, 0, 0]);
    expect(days.map((d) => d.level)).toEqual([1, 3, 0, 2, 0, 0, 0, 0]);
    expect(days[3]!.features.features).toHaveLength(1);
    expect(days[4]!.features.features).toHaveLength(0);
    expect(new Date(days[1]!.date).toISOString()).toBe("2026-10-19T12:00:00.000Z");
  });

  it("names the risk and picks the most active day (the earliest of equals)", () => {
    expect(dayRisk(days[1]!)).toBe("Enhanced Risk (3 of 5)");
    expect(dayRisk(days[1]!, "es")).toBe("Riesgo mejorado (3 de 5)");
    expect(dayRisk(days[3]!)).toBe("15% chance of severe storms");
    expect(dayRisk(days[2]!)).toBe("No severe risk");
    expect(dayRisk(days[6]!)).toBe("Low chance");
    expect(busiest(days)?.n).toBe(2);
    expect(busiest(days.map((d) => ({ ...d, level: 0 })))).toBeNull();
  });

  it("writes the title and descriptions", () => {
    const w = weeklyText(days);
    expect(w.title).toBe("Severe Weather Week Ahead, Oct 18 – Oct 25: Enhanced Risk Monday #shorts");
    expect(w.description).toContain("Mon, Oct 19: Enhanced Risk (3 of 5)");
    expect(w.description).toContain("Wed, Oct 21: 15% chance of severe storms");
    expect(w.es.title).toMatch(/^Tormentas severas, la semana \((18 oct\.?|oct\.? 18) – (25 oct\.?|oct\.? 25)\): riesgo mejorado el lunes #shorts$/);
    expect(w.es.description).toContain("no es un sistema oficial de alertas");
  });
});

const storm = (over: Partial<TropicalStorm>): TropicalStorm => ({
  id: "al182026",
  name: "Simon",
  classification: "HU",
  title: "Hurricane Simon",
  category: 1,
  windKt: 65,
  pressureMb: 985,
  lat: 24.5,
  lon: -80.1,
  movement: { towardDeg: 315, speedMph: 10 },
  advisoryUrl: "https://www.nhc.noaa.gov/text/MIATCPAT3.shtml",
  updated: "2026-10-14T15:00:00Z",
  cone: null,
  track: null,
  forecast: [
    { lat: 24.5, lon: -80.1, time: "2026-10-14T15:00:00Z", windKt: 65, label: "H1", tau: 0 },
    { lat: 25.5, lon: -81.0, time: "2026-10-15T00:00:00Z", windKt: 75, label: "H1", tau: 12 },
    { lat: 27.0, lon: -82.0, time: "2026-10-15T12:00:00Z", windKt: 90, label: "H2", tau: 24 },
    { lat: 30.0, lon: -83.0, time: "2026-10-16T12:00:00Z", windKt: 45, label: "TS", tau: 48 },
  ],
  pastTrack: null,
  label: "H1",
  basin: "Atlantic",
  advisory: { number: "12", issued: "2026-10-14T15:00:00Z" },
  ...over,
});

describe("tropical update", () => {
  it("posts named storms only, strongest first", () => {
    const list = [
      storm({ id: "a", windKt: 55, classification: "TS" }),
      storm({ id: "b", windKt: 30, classification: "TD" }),
      storm({ id: "c", windKt: 100 }),
      storm({ id: "d", windKt: 40, classification: "PTC" }),
      storm({ id: "e", windKt: 50, classification: "STS" }),
    ];
    expect(pickStorms(list).map((s) => s.id)).toEqual(["c", "a"]);
    expect(pickStorms(list, 5).map((s) => s.id)).toEqual(["c", "a", "e"]);
    expect(pickStorms([])).toEqual([]);
  });

  it("converts units and names directions, stages and time zones", () => {
    expect(toMph(65)).toBe(75);
    expect(toKmh(65)).toBe(120);
    expect(compass(315)).toBe("NW");
    expect(compass(-10)).toBe("N");
    expect(stageName("H2")).toBe("Category 2 hurricane");
    expect(stageName("H2", "es")).toBe("Huracán categoría 2");
    expect(stageName("PT")).toBe("Post-tropical");
    expect(zoneOf({ basin: "Eastern Pacific" })).toBe("America/Los_Angeles");
    expect(zoneOf({ basin: null })).toBe("America/New_York");
  });

  it("lists the forecast after the advisory position", () => {
    expect(upcoming(storm({})).map((p) => p.tau)).toEqual([12, 24, 48]);
  });

  it("writes the title and descriptions in English and Spanish", () => {
    const now = Date.parse("2026-10-14T15:40:00Z");
    const t = tropicalText(storm({}), now);
    expect(t.description).toContain("advisory 12, Wed, Oct 14, 11:00 AM EDT");
    expect(t.description).toContain("Maximum sustained winds 75 mph (Category 1), minimum pressure 985 mb.");
    expect(t.description).toContain("Located at 24.5°N 80.1°W, moving NW at 10 mph.");
    expect(t.description).toMatch(/Wed,? 8 PM: Category 1 hurricane, 85 mph/);
    expect(t.description).toContain("nhc.noaa.gov");
    expect(t.es.description).toContain("se mueve hacia el NO a 16 km/h");
    expect(t.es.description).toContain("Tormenta tropical");
    const ts = tropicalText(storm({ classification: "TS", title: "Tropical Storm Trudy", name: "Trudy", category: null, windKt: 55, basin: "Eastern Pacific", movement: { towardDeg: null, speedMph: null } }), now);
    expect(ts.es.title).toMatch(/^Tormenta tropical Trudy/);
    expect(ts.description).not.toContain("moving");
    // Simon's forecast peaks at H2; a tropical storm forecast to reach H1 becomes a hurricane.
    expect(t.title).toBe("Hurricane Simon Update, Wed, Oct 14: Category 1, 75 mph, Forecast to Reach Category 2 #shorts");
    expect(t.description).toContain("It is forecast to reach Category 2.");
    expect(t.es.title).toBe("Huracán Simon: categoría 1, 120 km/h; se pronostica que alcance la categoría 2 #shorts");
    expect(ts.title).toBe("Tropical Storm Trudy Update, Wed, Oct 14: 65 mph Winds, Forecast to Become a Hurricane #shorts");
    expect(ts.description).toContain("It is forecast to become a hurricane.");
    expect(peakAhead(storm({ forecast: [] }))).toBeNull();
  });
});

describe("outlook in Spanish", () => {
  const o = parseOutlook(`Day 1 Convective Outlook
Valid 141630Z - 151200Z

...THERE IS A SLIGHT RISK OF SEVERE THUNDERSTORMS ACROSS THE SOUTHERN PLAINS...

...SUMMARY...
Storms.
`)!;
  it("titles and describes it", () => {
    expect(titleForEs(o, Date.parse("2026-10-14T16:32:00Z"))).toMatch(/^Pronóstico de tormentas severas, mié,? 14 de oct\.?: Riesgo ligero \(nivel 2 de 5\) #shorts$/);
    const d = descriptionForEs(o, "Southern Plains", { tornado: 2, wind: 15, hail: 5 });
    expect(d).toContain("Riesgo ligero (nivel 2 de 5), en la región Southern Plains.");
    expect(d).toContain("Tornado 2%, vientos dañinos 15%, granizo grande 5%");
    expect(d).toContain("https://www.stormcentralwx.com");
  });
});

describe("fire", () => {
  const raw = (over: Record<string, unknown>) => ({
    attributes: { IrwinID: "{A}", IncidentName: "THREE QUEENS", IncidentSize: 9575, PercentContained: 33, POOState: "US-WA", POOCounty: "Kittitas", IncidentTypeCategory: "WF", FireDiscoveryDateTime: Date.parse("2026-07-15T20:00:00Z"), TotalIncidentPersonnel: 29, ...over },
    geometry: { x: -121.1, y: 47.5 },
  });
  const now = Date.parse("2026-10-15T20:30:00Z");

  it("reads active wildfires, largest first, leaving out burns and contained fires", () => {
    const fires = parseFires({ features: [raw({}), raw({ IrwinID: "{B}", IncidentName: "Bench", IncidentSize: 67071 }), raw({ IrwinID: "{C}", IncidentTypeCategory: "RX" }), raw({ IrwinID: "{D}", PercentContained: 100 })] });
    expect(fires.map((f) => f.name)).toEqual(["Bench Fire", "Three Queens Fire"]);
    expect(fires[1]).toMatchObject({ state: "WA", county: "Kittitas", acres: 9575, contained: 33, personnel: 29 });
    expect(fireName("Ridge Complex")).toBe("Ridge Complex");
  });

  it("picks a big, mostly uncontained fire, or one that grew fast since yesterday", () => {
    const fires = parseFires({ features: [raw({}), raw({ IrwinID: "{B}", IncidentName: "Bench", IncidentSize: 67071, PercentContained: 90 }), raw({ IrwinID: "{E}", IncidentName: "Small", IncidentSize: 3000, PercentContained: 95 })] });
    expect(pickFires(fires, null, now).map((p) => p.fire.name)).toEqual(["Three Queens Fire"]);
    const prev = { at: now - 24 * 3_600_000, sizes: { "{A}": 9_000, "{B}": 67_000, "{E}": 1_500 } };
    expect(pickFires(fires, prev, now, 2)).toEqual([
      { fire: expect.objectContaining({ name: "Small Fire" }), growth: 1500 },
      { fire: expect.objectContaining({ name: "Three Queens Fire" }), growth: 575 },
    ]);
    expect(growthSince(fires[0]!, { at: now - 3 * 86_400_000, sizes: { "{B}": 1 } }, now)).toBeNull();
  });

  it("writes the title and descriptions, with the growth when known", () => {
    const [f] = parseFires({ features: [raw({})] });
    const t = fireText(f!, 1200, now);
    expect(t.title).toBe("Three Queens Fire, Washington: 9,575 Acres, 33% Contained; Grew 1,200 Acres #shorts");
    expect(t.description).toContain("The Three Queens Fire in Kittitas County, Washington has burned 9,575 acres and is 33% contained");
    expect(t.description).toContain("It grew by 1,200 acres since yesterday.");
    expect(t.es.title).toContain("Incendio Three Queens, Washington: 3,875 hectáreas, 33% contenido");
  });
});
