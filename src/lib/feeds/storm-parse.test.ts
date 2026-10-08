import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../api/http";
import { haversineKm } from "../geo";
import { stormCellsFeed, type StormCell } from "./storm-cells";
import {
  cellEta,
  cellSeverity,
  cellTrack,
  iemTime,
  lsrKind,
  lsrWindow,
  parseHours,
  parseLsrGeoJson,
  parseMagnitude,
  parseNexradAttr,
  placeName,
  reportGroup,
  reportMagnitude,
  reportTitle,
  sourceLabel,
} from "./storm-parse";
import { stormReportsFeed } from "./storm-reports";
import { setUpstreamTransport, type UpstreamTransport } from "./upstream";

// ─── Fixtures (shaped like IEM's lsr.geojson and nexrad_attr.geojson) ───────

const pt = (lon: number | string, lat: number | string) => ({ type: "Point", coordinates: [lon, lat] });

const LSR_LOWER = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: pt(-93.65, 42.06),
      properties: {
        valid: "2026-10-07T21:12:00Z",
        type: "H",
        typetext: "HAIL",
        magnitude: "1.75",
        unit: "INCH",
        qualifier: "E",
        city: "3 NW AMES",
        county: "STORY",
        state: "IA",
        source: "TRAINED SPOTTER",
        remark: "Quarter to golf ball size hail.",
        wfo: "DMX",
        lat: 42.06,
        lon: -93.65,
      },
    },
    {
      type: "Feature",
      geometry: pt(-93.62, 41.99),
      properties: {
        valid: "2026-10-07 21:40",
        type: "G",
        typetext: "TSTM WND GST",
        magnitude: 61,
        unit: "MPH",
        qualifier: "M",
        city: "AMES AIRPORT",
        county: "STORY",
        state: "ia",
        source: "ASOS",
        remark: "",
        wfo: "DMX",
      },
    },
    {
      type: "Feature",
      geometry: pt(-94.1, 41.7),
      properties: { valid: "2026-10-07T20:58:00Z", type: "T", typetext: "TORNADO", magnitude: "", unit: "", qualifier: "U", city: "2 S JEFFERSON", county: "GREENE", state: "IA", source: "PUBLIC", remark: null, wfo: "DMX" },
    },
    // Junk: no position, no time, not an object, no type.
    { type: "Feature", geometry: null, properties: { valid: "2026-10-07T21:00:00Z", typetext: "HAIL" } },
    { type: "Feature", geometry: pt(-93, 41), properties: { typetext: "HAIL", magnitude: "1.00" } },
    null,
    "bogus",
    { type: "Feature", geometry: pt(-93, 41), properties: { valid: "2026-10-07T21:00:00Z" } },
    // A summary LSR repeating the hail report collapses onto the first one.
    {
      type: "Feature",
      geometry: pt(-93.65, 42.06),
      properties: { valid: "2026-10-07T21:12:00Z", typetext: "HAIL", magnitude: "1.75", unit: "INCH", qualifier: "E", city: "3 NW AMES", remark: "Summary" },
    },
  ],
};

const LSR_UPPER = {
  features: [
    {
      geometry: pt("-97.49", "35.43"),
      properties: {
        VALID: "202610072230",
        TYPE: "F",
        TYPETEXT: "Flash Flood",
        MAG: "0",
        UNIT: null,
        QUALIFY: "E",
        CITY: "2 SSE OKLAHOMA CITY",
        COUNTY: "OKLAHOMA",
        STATE: "OK",
        SOURCE: "EMERGENCY MNGR",
        REMARK: "WATER OVER ROAD AT I-35 AND SE 29TH.",
        WFO: "OUN",
      },
    },
    // Magnitude carries its own qualifier and unit, and there's no geometry.
    { properties: { VALID: "2026-10-07T22:05:00", TYPETEXT: "NON-TSTM WND GST", MAGNITUDE: "E52 KTS", LAT: "35.1", LON: "-97.2", CITY: "NORMAN" } },
    // Only IEM's one-letter type code.
    { properties: { valid: "2026-10-07T22:10:00Z", type: "D", lat: 35.0, lon: -97.0, city: "PURCELL" } },
  ],
};

const ATTR = {
  type: "FeatureCollection",
  generation_time: "2026-10-07T21:50:00Z",
  features: [
    {
      type: "Feature",
      id: "TLX_A3",
      geometry: pt(-97.9, 35.2),
      properties: {
        nexrad: "TLX",
        storm_id: "A3",
        valid: "2026-10-07T21:47:00Z",
        azimuth: 237,
        range: 31,
        tvs: "TVS",
        meso: "7",
        posh: 60,
        poh: 100,
        max_size: 1.75,
        vil: 58,
        max_dbz: 65,
        max_dbz_height: 21.3,
        top: 45.1,
        drct: 240,
        sknt: 30,
      },
    },
    {
      type: "Feature",
      geometry: pt("-86.3", "39.7"),
      properties: {
        NEXRAD: "IND",
        STORM_ID: "q0",
        VALID: "2026-10-07 21:45",
        TVS: "NONE",
        MESO: "NONE",
        POSH: "10",
        POH: "40",
        MAX_SIZE: "0.50",
        VIL: "25",
        MAX_DBZ: "55",
        MAX_DBZ_HEIGHT: "12.0",
        TOP: "30.2",
        DRCT: "225",
        SKNT: "25",
      },
    },
    // Low-topped mesocyclone on a brand-new cell (0°/0 kt = no motion yet).
    { type: "Feature", geometry: pt(-98.5, 36.1), properties: { nexrad: "VNX", storm_id: "B7", valid: "2026-10-07T21:46:00Z", meso: "5L", tvs: "NONE", posh: 0, poh: 0, max_size: 0, max_dbz: 50, drct: 0, sknt: 0 } },
    // Nothing meaningful: every value missing or a sentinel.
    { type: "Feature", geometry: pt(-99, 37), properties: { nexrad: "DDC", storm_id: "C1", valid: "2026-10-07T21:46:00Z", tvs: "NONE", meso: "NONE", posh: -999, poh: -1, max_size: -1, vil: null, max_dbz: "", top: null, drct: null, sknt: null } },
    // Ids only in the feature id, time from generation_time.
    { type: "Feature", id: "FWS_K1", geometry: pt(-97.3, 32.7), properties: { posh: "35", max_size: "0.75" } },
    // Stale: two hours old.
    { type: "Feature", geometry: pt(-95, 30), properties: { nexrad: "HGX", storm_id: "Z9", valid: "2026-10-07T19:50:00Z", posh: 80, max_size: 2.5 } },
    // Older scan of TLX A3 from an earlier volume: the newer one wins.
    { type: "Feature", geometry: pt(-98.0, 35.1), properties: { nexrad: "TLX", storm_id: "A3", valid: "2026-10-07T21:42:00Z", posh: 40, max_size: 1.0 } },
    // No position.
    { type: "Feature", geometry: null, properties: { nexrad: "LOT", storm_id: "D2", valid: "2026-10-07T21:46:00Z", posh: 50 } },
  ],
};

const NOW = Date.parse("2026-10-07T21:52:00Z");

// ─── Local storm reports ────────────────────────────────────────────────────

describe("parseLsrGeoJson", () => {
  it("reads lower-case IEM properties, newest first, skipping junk and duplicates", () => {
    const reports = parseLsrGeoJson(LSR_LOWER);
    expect(reports.map((r) => r.typeText)).toEqual(["TSTM WND GST", "HAIL", "TORNADO"]);
    const [wind, hail, tornado] = reports;
    expect(hail).toEqual({
      id: "202610072112_42.060_-93.650_hail",
      time: "2026-10-07T21:12:00.000Z",
      kind: "hail",
      typeText: "HAIL",
      magnitude: 1.75,
      unit: "INCH",
      measured: false,
      place: "3 NW AMES",
      county: "STORY",
      state: "IA",
      source: "TRAINED SPOTTER",
      remark: "Quarter to golf ball size hail.",
      wfo: "DMX",
      lat: 42.06,
      lon: -93.65,
    });
    expect(wind).toMatchObject({ time: "2026-10-07T21:40:00.000Z", kind: "wind", magnitude: 61, unit: "MPH", measured: true, state: "IA", remark: null });
    expect(tornado).toMatchObject({ kind: "tornado", magnitude: null, unit: null, measured: null, remark: null });
  });

  it("reads upper-case keys, magnitude strings and bare type codes", () => {
    const reports = parseLsrGeoJson(LSR_UPPER);
    expect(reports.map((r) => r.kind)).toEqual(["flood", "wind-damage", "wind"]);
    const [flood, dmg, gust] = reports;
    expect(flood).toMatchObject({
      time: "2026-10-07T22:30:00.000Z",
      typeText: "FLASH FLOOD",
      magnitude: null, // "0" is no magnitude
      measured: null,
      place: "2 SSE OKLAHOMA CITY",
      source: "EMERGENCY MNGR",
      wfo: "OUN",
      lat: 35.43,
      lon: -97.49,
    });
    expect(gust).toMatchObject({ magnitude: 52, unit: "KTS", measured: false, lat: 35.1, lon: -97.2, time: "2026-10-07T22:05:00.000Z" });
    expect(dmg).toMatchObject({ typeText: "TSTM WND DMG", place: "PURCELL", county: null });
  });

  it("returns nothing for junk", () => {
    expect(parseLsrGeoJson(null)).toEqual([]);
    expect(parseLsrGeoJson({ features: "nope" })).toEqual([]);
    expect(parseLsrGeoJson({ type: "FeatureCollection", features: [] })).toEqual([]);
  });

  it("assumes inches for hail without a unit", () => {
    const [r] = parseLsrGeoJson({ features: [{ geometry: pt(-90, 40), properties: { valid: "2026-10-07T21:00:00Z", typetext: "HAIL", magnitude: "1.00" } }] });
    expect(r).toMatchObject({ magnitude: 1, unit: "INCH" });
  });
});

describe("lsrKind", () => {
  it.each([
    ["TORNADO", "tornado"],
    ["WATERSPOUT", "tornado"],
    ["FUNNEL CLOUD", "funnel"],
    ["COLD AIR FUNNEL", "funnel"],
    ["HAIL", "hail"],
    ["MARINE HAIL", "hail"],
    ["TSTM WND GST", "wind"],
    ["NON-TSTM WND GST", "wind"],
    ["MARINE TSTM WIND", "wind"],
    ["HIGH SUST WINDS", "wind"],
    ["TSTM WND DMG", "wind-damage"],
    ["NON-TSTM WND DMG", "wind-damage"],
    ["DOWNBURST", "wind-damage"],
    ["FLASH FLOOD", "flood"],
    ["FLOOD", "flood"],
    ["COASTAL FLOOD", "flood"],
    ["HEAVY RAIN", "rain"],
    ["FREEZING RAIN", "snow"],
    ["SNOW", "snow"],
    ["HEAVY SNOW", "snow"],
    ["BLIZZARD", "snow"],
    ["ICE STORM", "snow"],
    ["EXTR WIND CHILL", "other"],
    ["LIGHTNING", "other"],
    ["DUST STORM", "other"],
    ["", "other"],
  ] as const)("%s → %s", (text, kind) => {
    expect(lsrKind(text)).toBe(kind);
  });

  it("falls back to the one-letter code", () => {
    expect(lsrKind(null, "h")).toBe("hail");
    expect(lsrKind("", "T")).toBe("tornado");
    expect(lsrKind(undefined, "?")).toBe("other");
  });

  it("groups kinds for the summary", () => {
    expect(reportGroup("wind-damage")).toBe("wind");
    expect(reportGroup("funnel")).toBe("other");
    expect(reportGroup("rain")).toBe("other");
    expect(reportGroup("flood")).toBe("flood");
  });
});

describe("parseMagnitude", () => {
  it("reads numbers and LSR magnitude text", () => {
    expect(parseMagnitude(1.75)).toEqual({ value: 1.75, qualifier: null, unit: null });
    expect(parseMagnitude(" 2.00 ")).toEqual({ value: 2, qualifier: null, unit: null });
    expect(parseMagnitude("E61 MPH")).toEqual({ value: 61, qualifier: "E", unit: "MPH" });
    expect(parseMagnitude("m1.00 inch")).toEqual({ value: 1, qualifier: "M", unit: "INCH" });
    expect(parseMagnitude("EF2")).toEqual({ value: 2, qualifier: null, unit: "EF" });
  });

  it("treats empty, zero, trace and junk as missing", () => {
    for (const v of ["", "0", "0.00", "T", "NONE", "M", null, undefined, -1, Number.NaN, {}]) expect(parseMagnitude(v).value).toBeNull();
  });
});

describe("iemTime", () => {
  it("normalises IEM timestamp styles to ISO UTC", () => {
    const iso = "2026-10-07T21:12:00.000Z";
    for (const v of ["2026-10-07T21:12:00Z", "2026-10-07 21:12", "2026-10-07T21:12", "2026-10-07T21:12:00+00", "2026-10-07T16:12:00-05:00", "202610072112", Date.parse(iso), Date.parse(iso) / 1000])
      expect(iemTime(v)).toBe(iso);
  });

  it("rejects junk", () => {
    for (const v of ["", "soon", null, undefined, 0, {}]) expect(iemTime(v)).toBeNull();
  });
});

describe("report window", () => {
  it("clamps hours to 1–24 and defaults to 6", () => {
    expect(parseHours(null)).toBe(6);
    expect(parseHours("")).toBe(6);
    expect(parseHours("12")).toBe(12);
    expect(parseHours("0")).toBe(1);
    expect(parseHours("72")).toBe(24);
    expect(parseHours("2.6")).toBe(3);
    expect(parseHours("six")).toBeNull();
  });

  it("rounds the end up to 2 minutes so polls share a cache key", () => {
    const a = lsrWindow(Date.parse("2026-10-07T21:12:05Z"), 6);
    const b = lsrWindow(Date.parse("2026-10-07T21:13:59Z"), 6);
    expect(a).toEqual({ sts: "202610071514", ets: "202610072114" });
    expect(b).toEqual(a);
    expect(lsrWindow(Date.parse("2026-10-07T21:14:00Z"), 1)).toEqual({ sts: "202610072014", ets: "202610072114" });
    expect(lsrWindow(Date.parse("2026-10-07T00:30:00Z"), 24).sts).toBe("202610060030");
  });
});

describe("report presentation", () => {
  const r = (kind: Parameters<typeof reportMagnitude>[0]["kind"], magnitude: number | null, unit: string | null) => ({ kind, magnitude, unit });

  it("converts magnitudes to SI", () => {
    const hail = reportMagnitude(r("hail", 1.75, "INCH"));
    expect(hail?.kind === "length" && hail.mm).toBeCloseTo(44.45, 6);
    expect(reportMagnitude(r("hail", 1, null))).toEqual({ kind: "length", mm: 25.4 });
    const mph = reportMagnitude(r("wind", 70, "MPH"));
    expect(mph?.kind === "speed" && mph.ms).toBeCloseTo(31.29, 2);
    const kt = reportMagnitude(r("wind", 52, "KTS"));
    expect(kt?.kind === "speed" && kt.ms).toBeCloseTo(26.75, 2);
    const bare = reportMagnitude(r("wind-damage", 60, null));
    expect(bare?.kind).toBe("speed");
    expect(reportMagnitude(r("tornado", 2, "F"))).toEqual({ kind: "rating", text: "EF2" });
    expect(reportMagnitude(r("flood", 3, "FT"))).toEqual({ kind: "other", value: 3, unit: "FT" });
    expect(reportMagnitude(r("hail", null, "INCH"))).toBeNull();
  });

  it("spells out NWS type text in sentence case", () => {
    expect(reportTitle("TSTM WND GST")).toBe("Thunderstorm wind gust");
    expect(reportTitle("NON-TSTM WND DMG")).toBe("Non-thunderstorm wind damage");
    expect(reportTitle("HIGH SUST WINDS")).toBe("High sustained winds");
    expect(reportTitle("FUNNEL CLOUD")).toBe("Funnel cloud");
  });

  it("title-cases place names but keeps compass points and route prefixes", () => {
    expect(placeName("3 NW AMES")).toBe("3 NW Ames");
    expect(placeName("4 SSE ST. LOUIS")).toBe("4 SSE St. Louis");
    expect(placeName("1 E O'NEILL")).toBe("1 E O'Neill");
    expect(placeName("2 N WINSTON-SALEM")).toBe("2 N Winston-Salem");
    expect(placeName("US-30 AND I-35")).toBe("US-30 and I-35");
    expect(placeName("Already Mixed")).toBe("Already Mixed");
    expect(placeName(null)).toBe("");
  });

  it("sentence-cases sources, keeping acronyms", () => {
    expect(sourceLabel("TRAINED SPOTTER")).toBe("Trained spotter");
    expect(sourceLabel("EMERGENCY MNGR")).toBe("Emergency manager");
    expect(sourceLabel("NWS STORM SURVEY")).toBe("NWS storm survey");
    expect(sourceLabel("COCORAHS")).toBe("CoCoRaHS");
    expect(sourceLabel("FIRE DEPT/RESCUE")).toBe("Fire department/rescue");
  });
});

// ─── NEXRAD storm cells ─────────────────────────────────────────────────────

describe("parseNexradAttr", () => {
  const cells = parseNexradAttr(ATTR, { now: NOW });
  const byId = Object.fromEntries(cells.map((c) => [c.id, c]));

  it("keeps meaningful, fresh cells, most severe first", () => {
    expect(cells.map((c) => c.id)).toEqual(["TLX-A3", "VNX-B7", "FWS-K1", "IND-Q0"]);
  });

  it("reads lower-case attributes", () => {
    expect(byId["TLX-A3"]).toEqual({
      id: "TLX-A3",
      radar: "TLX",
      stormId: "A3",
      lat: 35.2,
      lon: -97.9,
      time: "2026-10-07T21:47:00.000Z", // the newer of the two scans
      hailProb: 100,
      severeHailProb: 60,
      maxHailIn: 1.75,
      meso: 7,
      tvs: "TVS",
      vil: 58,
      maxDbz: 65,
      topKft: 45.1,
      motion: { fromDeg: 240, speedKt: 30 },
      maxDbzHeightKft: 21.3,
      azimuthDeg: 237,
      rangeNm: 31,
    } satisfies StormCell);
  });

  it("reads upper-case keys and numeric strings, NONE as null", () => {
    expect(byId["IND-Q0"]).toMatchObject({
      stormId: "Q0",
      time: "2026-10-07T21:45:00.000Z",
      tvs: null,
      meso: null,
      severeHailProb: 10,
      hailProb: 40,
      maxHailIn: 0.5,
      vil: 25,
      maxDbz: 55,
      topKft: 30.2,
      motion: { fromDeg: 225, speedKt: 25 },
    });
  });

  it("reads rank suffixes, unknown motion and feature-id fallbacks", () => {
    expect(byId["VNX-B7"]).toMatchObject({ meso: 5, tvs: null, motion: null, maxHailIn: 0, severeHailProb: 0 });
    expect(byId["FWS-K1"]).toMatchObject({ radar: "FWS", stormId: "K1", time: "2026-10-07T21:50:00.000Z", severeHailProb: 35, maxHailIn: 0.75 });
  });

  it("drops sentinel-only, stale and position-less rows", () => {
    expect(byId["DDC-C1"]).toBeUndefined();
    expect(byId["HGX-Z9"]).toBeUndefined();
    expect(byId["LOT-D2"]).toBeUndefined();
    // Without `now` there's no age filter.
    expect(parseNexradAttr(ATTR).some((c) => c.id === "HGX-Z9")).toBe(true);
  });

  it("returns nothing for junk", () => {
    expect(parseNexradAttr(undefined)).toEqual([]);
    expect(parseNexradAttr({ features: [null, 1, { properties: null }] })).toEqual([]);
  });
});

describe("cell severity, track and ETA", () => {
  const base: StormCell = {
    id: "TLX-A1",
    radar: "TLX",
    stormId: "A1",
    lat: 35,
    lon: -98,
    time: "2026-10-07T21:47:00Z",
    hailProb: null,
    severeHailProb: null,
    maxHailIn: null,
    meso: null,
    tvs: null,
    vil: null,
    maxDbz: 50,
    topKft: null,
    motion: { fromDeg: 270, speedKt: 30 },
  };

  it("ranks TVS > mesocyclone > severe hail > watch > ordinary", () => {
    expect(cellSeverity({ ...base, tvs: "ETVS" })).toBe(4);
    expect(cellSeverity({ ...base, meso: 6 })).toBe(3);
    expect(cellSeverity({ ...base, maxHailIn: 1 })).toBe(2);
    expect(cellSeverity({ ...base, severeHailProb: 50 })).toBe(2);
    expect(cellSeverity({ ...base, severeHailProb: 30 })).toBe(1);
    expect(cellSeverity({ ...base, meso: 2 })).toBe(1);
    expect(cellSeverity({ ...base, severeHailProb: 20, maxHailIn: 0.75 })).toBe(0);
  });

  it("projects the track toward drct + 180°", () => {
    const track = cellTrack(base);
    expect(track.map((t) => t.minutes)).toEqual([15, 30, 45, 60]);
    const end = track[3]!;
    // From the west → moves east, ~55.6 km in an hour at 30 kt.
    expect(end.lon).toBeGreaterThan(base.lon);
    expect(end.lat).toBeCloseTo(base.lat, 1);
    expect(haversineKm(base, end)).toBeCloseTo(55.56, 0);
    const south = cellTrack({ ...base, motion: { fromDeg: 0, speedKt: 30 } })[0]!;
    expect(south.lat).toBeLessThan(base.lat);
    expect(cellTrack({ ...base, motion: null })).toEqual([]);
    expect(cellTrack({ ...base, motion: { fromDeg: 90, speedKt: 0.5 } })).toEqual([]);
  });

  it("estimates arrival within a 10 km corridor and the 60-minute horizon", () => {
    const now = Date.parse(base.time);
    const eastOf = (km: number, northKm = 0) => ({ lat: base.lat + northKm / 111.2, lon: base.lon + km / (111.2 * Math.cos((base.lat * Math.PI) / 180)) });
    expect(cellEta(base, eastOf(20), { now })).toBeCloseTo(21.6, 0);
    // Ten minutes after the scan the cell has moved ~9 km closer.
    expect(cellEta(base, eastOf(20), { now: now + 10 * 60_000 })).toBeCloseTo(11.6, 0);
    expect(cellEta(base, eastOf(20, 15), { now })).toBeNull(); // passes 15 km to the side
    expect(cellEta(base, eastOf(-20), { now })).toBeNull(); // moving away
    expect(cellEta(base, eastOf(80), { now })).toBeNull(); // ~86 min out
    expect(cellEta({ ...base, motion: null }, eastOf(20), { now })).toBeNull();
  });
});

// ─── Feeds (mocked transport) ───────────────────────────────────────────────

describe("storm feeds", () => {
  afterEach(() => vi.useRealTimers());

  const mock = (fn: UpstreamTransport) => {
    const calls: string[] = [];
    setUpstreamTransport(async (url, req) => {
      calls.push(url);
      return fn(url, req);
    });
    return calls;
  };

  it("rejects a non-numeric hours value before touching the network", async () => {
    const calls = mock(async () => LSR_LOWER);
    await expect(stormReportsFeed.load(new URLSearchParams("hours=six"))).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it("requests the rounded IEM window and clamps hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T21:51:30Z"));
    const calls = mock(async () => LSR_LOWER);
    const res = await stormReportsFeed.load(new URLSearchParams("hours=48"));
    expect(calls).toEqual(["https://mesonet.agron.iastate.edu/geojson/lsr.geojson?sts=202610062152&ets=202610072152"]);
    expect(res.hours).toBe(24);
    expect(res.reports).toHaveLength(3);
  });

  it("falls back to the script URL when the storm-attribute GeoJSON 404s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const calls = mock(async (url) => {
      if (url.endsWith(".geojson")) throw new HttpError("Upstream 404", 404, url);
      return ATTR;
    });
    const res = await stormCellsFeed.load(new URLSearchParams());
    expect(calls).toEqual(["https://mesonet.agron.iastate.edu/geojson/nexrad_attr.geojson", "https://mesonet.agron.iastate.edu/geojson/nexrad_attr.py"]);
    expect(res.cells.map((c) => c.id)).toEqual(["TLX-A3", "VNX-B7", "FWS-K1", "IND-Q0"]);
  });
});
