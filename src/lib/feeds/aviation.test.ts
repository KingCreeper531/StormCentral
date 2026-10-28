import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "../api/http";
import { MAX_AVIATION_TILES, parseTileBox, snapToTiles, tilesIn } from "../aviation";
import {
  advisoryHazard,
  advisoryRing,
  apiTime,
  aviationAdvisoriesFeed,
  aviationAirportFeed,
  aviationMetarsFeed,
  parseAirport,
  parseAirSigmets,
  parseGairmets,
  parseMetarRows,
} from "./aviation";
import { setUpstreamTransport } from "./upstream";

/*
 * Shapes of aviationweather.gov's Data API (api/data, format=json), from its
 * OpenAPI docs and sample responses. The sandbox these tests were written in
 * couldn't reach the live API, so check against it when you can:
 *   curl -A "StormCentral/…" "https://aviationweather.gov/api/data/metar?format=json&bbox=30,-100,40,-90"
 */
const NOW = Date.parse("2026-10-20T18:10:00Z");
const s = (iso: string) => Date.parse(iso) / 1000;

const metar = (over: Record<string, unknown> = {}) => ({
  icaoId: "KOKC",
  receiptTime: "2026-10-20T17:56:12.345Z",
  obsTime: s("2026-10-20T17:52:00Z"),
  reportTime: "2026-10-20T18:00:00.000Z",
  temp: 22.8,
  dewp: 10.6,
  wdir: 180,
  wspd: 12,
  wgst: 20,
  visib: "10+",
  altim: 1015.2,
  slp: 1014.1,
  qcField: 4,
  wxString: null,
  metarType: "METAR",
  rawOb: "METAR KOKC 201752Z 18012G20KT 10SM FEW250 23/11 A2998 RMK AO2 SLP141 T02280106",
  mostRecent: 1,
  lat: 35.3889,
  lon: -97.6006,
  elev: 397,
  prior: 1,
  name: "Oklahoma City/Will Rogers Wld, OK, US",
  clouds: [{ cover: "FEW", base: 25000 }],
  fltCat: "VFR",
  ...over,
});

describe("parseMetarRows", () => {
  it("keeps id, position and the category worked out from the report", () => {
    expect(parseMetarRows([metar()], NOW)).toEqual([["KOKC", 35.389, -97.601, "VFR"]]);
    // The report itself wins over the API's own field…
    const ifr = metar({ rawOb: "METAR KOKC 201752Z 18012KT 2SM BR OVC007 15/14 A2998", fltCat: "VFR" });
    expect(parseMetarRows([ifr], NOW)[0]![3]).toBe("IFR");
    // …which stands in when the report can't be read.
    expect(parseMetarRows([metar({ rawOb: "garbled", fltCat: "MVFR" })], NOW)[0]![3]).toBe("MVFR");
    expect(parseMetarRows([metar({ rawOb: "garbled", fltCat: "XX" })], NOW)[0]![3]).toBeNull();
  });

  it("keeps each airport's newest report and drops stale ones", () => {
    const older = metar({ obsTime: s("2026-10-20T16:52:00Z"), rawOb: "METAR KOKC 201652Z 18010KT 1/2SM FG VV002 15/15 A2998" });
    expect(parseMetarRows([older, metar()], NOW)).toEqual([["KOKC", 35.389, -97.601, "VFR"]]);
    expect(parseMetarRows([metar({ obsTime: s("2026-10-20T12:52:00Z") })], NOW)).toEqual([]);
  });

  it("skips rows without an id or position, and anything that isn't a list", () => {
    expect(parseMetarRows([metar({ icaoId: "" }), metar({ lat: null }), null, "x"], NOW)).toEqual([]);
    expect(parseMetarRows({ error: "x" }, NOW)).toEqual([]);
  });
});

describe("airport tiles", () => {
  it("grow the view to whole 10° tiles", () => {
    expect(snapToTiles({ west: -98.7, south: 33.1, east: -95.2, north: 37.4 })).toEqual([-100, 30, -90, 40]);
    expect(tilesIn([-100, 30, -80, 40])).toEqual([
      [30, -100],
      [30, -90],
    ]);
  });

  it("refuse views too wide to load, and clamp to the world", () => {
    expect(snapToTiles({ west: -170, south: -60, east: 170, north: 80 })).toBeNull();
    expect(snapToTiles({ west: -200, south: 60, east: -175, north: 95 })).toEqual([-180, 60, -170, 90]);
  });

  it("only accept aligned boxes of a few tiles from clients", () => {
    expect(parseTileBox("-100,30,-90,40")).toEqual([-100, 30, -90, 40]);
    expect(parseTileBox("-101,30,-90,40")).toBeNull();
    expect(parseTileBox("-90,30,-100,40")).toBeNull();
    expect(parseTileBox("-180,-90,180,90")).toBeNull();
    expect(parseTileBox("-100,30,-90")).toBeNull();
    expect(parseTileBox(",30,-90,40")).toBeNull();
    expect(parseTileBox(null)).toBeNull();
    expect(tilesIn(parseTileBox("-130,20,-60,50")!).length).toBeLessThanOrEqual(MAX_AVIATION_TILES);
  });
});

describe("parseAirport", () => {
  const taf = {
    icaoId: "KOKC",
    dbPopTime: "2026-10-20 17:24:10",
    bulletinTime: "2026-10-20 17:20:00",
    issueTime: "2026-10-20T17:20:00.000Z",
    validTimeFrom: s("2026-10-20T18:00:00Z"),
    validTimeTo: s("2026-10-21T18:00:00Z"),
    rawTAF: "TAF KOKC 201720Z 2018/2118 18012G22KT P6SM SCT250 FM210000 17008KT P6SM BKN100",
    mostRecent: 1,
    remarks: "",
    lat: 35.3889,
    lon: -97.6006,
    elev: 397,
    prior: 1,
    name: "Oklahoma City/Will Rogers Wld, OK, US",
    fcsts: [],
  };

  it("keeps the latest METAR and TAF as sent", () => {
    expect(parseAirport("KOKC", [metar()], [taf])).toMatchObject({
      id: "KOKC",
      name: "Oklahoma City/Will Rogers Wld, OK, US",
      lat: 35.3889,
      elevM: 397,
      metar: { raw: metar().rawOb, time: "2026-10-20T17:52:00.000Z" },
      taf: { raw: taf.rawTAF, issued: "2026-10-20T17:20:00.000Z" },
    });
  });

  it("copes with an airport that has no TAF, or nothing at all", () => {
    expect(parseAirport("KOKC", [metar()], []).taf).toBeNull();
    expect(parseAirport("KXYZ", [], [])).toMatchObject({ id: "KXYZ", name: null, metar: null, taf: null });
  });
});

describe("SIGMETs and AIRMETs", () => {
  const coords = [
    { lat: 36.1, lon: -99.2 },
    { lat: 37.3, lon: -96.8 },
    { lat: 35.4, lon: -95.1 },
    { lat: 34.2, lon: -97.9 },
    { lat: 36.1, lon: -99.2 },
  ];
  const conv = {
    airSigmetId: 1234567,
    icaoId: "KKCI",
    receiptTime: "2026-10-20T17:55:00.000Z",
    validTimeFrom: s("2026-10-20T17:55:00Z"),
    validTimeTo: s("2026-10-20T19:55:00Z"),
    airSigmetType: "SIGMET",
    alphaChar: "C",
    hazard: "CONVECTIVE",
    severity: 1,
    altitudeLow1: null,
    altitudeLow2: null,
    altitudeHi1: 45000,
    altitudeHi2: null,
    movementDir: 240,
    movementSpd: 25,
    rawAirSigmet:
      "WSUS32 KKCI 201755\nSIGC\nCONVECTIVE SIGMET 45C\nVALID UNTIL 1955Z\nOK KS\nFROM 30NW END-40SE ICT-30W MLC-30NW ADM-30NW END\nAREA SEV TS MOV FROM 24025KT. TOPS ABV FL450.\nTORNADOES...HAIL TO 2 IN...WIND GUSTS TO 60KT POSS.",
    seriesId: "45C",
    coords,
  };
  const turb = { ...conv, seriesId: "PAPA 2", hazard: "TURB", severity: 4, altitudeLow1: 25000, altitudeHi1: 38000, rawAirSigmet: "SIGMET PAPA 2 VALID UNTIL 2200Z\nSEV TURB BTN FL250 AND FL380." };
  const outlook = { ...conv, airSigmetType: "OUTLOOK" };
  const expired = { ...conv, seriesId: "40C", validTimeTo: s("2026-10-20T17:55:00Z") };

  it("keep current SIGMETs and convective SIGMETs with their outline, tops and text", () => {
    const [c, t, ...rest] = parseAirSigmets([conv, turb, outlook, expired, { ...conv, coords: [{ lat: 1, lon: 1 }] }], NOW);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ kind: "convective", hazard: "convective", from: "2026-10-20T17:55:00.000Z", to: "2026-10-20T19:55:00.000Z", baseFt: null, topFt: 45000 });
    expect(c!.text).toContain("CONVECTIVE SIGMET 45C");
    expect(c!.ring).toHaveLength(5);
    expect(c!.ring[0]).toEqual([-99.2, 36.1]);
    expect(t).toMatchObject({ kind: "sigmet", hazard: "turbulence", baseFt: 25000, topFt: 38000 });
    expect(c!.id).not.toBe(t!.id);
  });

  it("close an open outline and read coordinates sent as text", () => {
    const ring = advisoryRing([
      { lat: "40.0", lon: "-100.0" },
      { lat: "41.0", lon: "-99.0" },
      { lat: "40.0", lon: "-98.0" },
    ]);
    expect(ring).toEqual([
      [-100, 40],
      [-99, 41],
      [-98, 40],
      [-100, 40],
    ]);
    expect(advisoryRing([{ lat: 1, lon: 1 }, { lat: 1, lon: 1 }, { lat: 2, lon: 2 }])).toBeNull();
    expect(advisoryRing(undefined)).toBeNull();
  });

  it("name the API's hazards", () => {
    expect(advisoryHazard("CONVECTIVE")).toBe("convective");
    expect(advisoryHazard("TURB-HI")).toBe("turbulence");
    expect(advisoryHazard("ICE")).toBe("icing");
    expect(advisoryHazard("IFR")).toBe("ifr");
    expect(advisoryHazard("MTN OBSCN")).toBe("mountain");
    expect(advisoryHazard("MT_OBSC")).toBe("mountain");
    expect(advisoryHazard("SFC_WND")).toBe("wind");
    expect(advisoryHazard("LLWS")).toBe("llws");
    expect(advisoryHazard("ASH")).toBe("ash");
    expect(advisoryHazard("FZLVL")).toBeNull();
    expect(advisoryHazard("M_FZLVL")).toBeNull();
  });

  const gairmet = (over: Record<string, unknown>) => ({
    tag: "1W",
    forecastHour: 0,
    validTime: "2026-10-20T18:00:00Z",
    issueTime: "2026-10-20T14:45:00Z",
    product: "SIERRA",
    hazard: "IFR",
    geometryType: "AREA",
    dueTo: "CIG BLW 010/VIS BLW 3SM BR",
    coords: coords.map((c) => ({ lat: String(c.lat), lon: String(c.lon) })),
    ...over,
  });

  it("keep each G-AIRMET product's snapshot nearest now, areas only", () => {
    const rows = [
      gairmet({}),
      gairmet({ forecastHour: 3, validTime: "2026-10-20T21:00:00Z" }),
      gairmet({ product: "TANGO", hazard: "TURB-HI", dueTo: "", base: "180", top: "390", tag: "2W" }),
      gairmet({ product: "ZULU", hazard: "FZLVL", geometryType: "LINE" }),
      gairmet({ product: "ZULU", hazard: "ICE", base: "FZL", top: "160" }),
    ];
    const out = parseGairmets(rows, NOW);
    expect(out.map((a) => [a.hazard, a.from, a.to])).toEqual([
      ["ifr", "2026-10-20T18:00:00.000Z", "2026-10-20T21:00:00.000Z"],
      ["turbulence", "2026-10-20T18:00:00.000Z", "2026-10-20T21:00:00.000Z"],
      ["icing", "2026-10-20T18:00:00.000Z", "2026-10-20T21:00:00.000Z"],
    ]);
    expect(out[0]).toMatchObject({ kind: "gairmet", text: "SIERRA IFR: CIG BLW 010/VIS BLW 3SM BR" });
    expect(out[1]).toMatchObject({ baseFt: 18000, topFt: 39000, text: "TANGO TURB-HI" });
    expect(out[2]).toMatchObject({ baseFt: null, topFt: 16000 });
  });

  it("reads Unix seconds and ISO times alike", () => {
    expect(apiTime(1792519200)).toBe(1792519200000);
    expect(apiTime("2026-10-20T18:00:00Z")).toBe(Date.parse("2026-10-20T18:00:00Z"));
    expect(apiTime("soon")).toBeNull();
  });
});

describe("aviation feeds", () => {
  afterEach(() => setUpstreamTransport(async () => ({})));

  it("reject bad parameters before touching the network", async () => {
    await expect(aviationMetarsFeed.load(new URLSearchParams("bbox=-98.5,33,-95,37"))).rejects.toMatchObject({ status: 400 });
    await expect(aviationMetarsFeed.load(new URLSearchParams())).rejects.toMatchObject({ status: 400 });
    await expect(aviationAirportFeed.load(new URLSearchParams("id=../x"))).rejects.toMatchObject({ status: 400 });
  });

  it("load each tile once, by the Data API's lat0,lon0,lat1,lon1 bbox, and merge airports on tile edges", async () => {
    const asked: { url: string; ua: string | undefined }[] = [];
    setUpstreamTransport(async (url, req) => {
      asked.push({ url, ua: req.headers["User-Agent"] });
      return [metar({ obsTime: Date.now() / 1000 - 600 }), metar({ icaoId: url.includes("bbox=40,") ? "KICT" : "KTUL", obsTime: Date.now() / 1000 - 600 })];
    });
    const res = await aviationMetarsFeed.load(new URLSearchParams("bbox=-120,30,-110,50"));
    expect(asked.map((a) => a.url).sort()).toEqual([
      "https://aviationweather.gov/api/data/metar?format=json&bbox=30,-120,40,-110",
      "https://aviationweather.gov/api/data/metar?format=json&bbox=40,-120,50,-110",
    ]);
    expect(asked[0]!.ua).toMatch(/StormCentral/);
    expect(res.airports.map((a) => a[0]).sort()).toEqual(["KICT", "KOKC", "KTUL"]);
    // Cached: a second viewer of the same tiles costs nothing upstream.
    await aviationMetarsFeed.load(new URLSearchParams("bbox=-120,30,-110,50"));
    expect(asked).toHaveLength(2);
  });

  it("read the Data API's empty answer (204, no body) as no data", async () => {
    setUpstreamTransport(async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    });
    expect((await aviationMetarsFeed.load(new URLSearchParams("bbox=170,-90,180,-80"))).airports).toEqual([]);
    expect(await aviationAirportFeed.load(new URLSearchParams("id=ZZZZ"))).toMatchObject({ metar: null, taf: null });
  });

  it("serve SIGMETs and G-AIRMETs even when one of them is down", async () => {
    setUpstreamTransport(async (url) => {
      if (url.includes("gairmet")) throw new HttpError("Upstream 403 for aviationweather.gov", 403, url);
      return [];
    });
    const res = await aviationAdvisoriesFeed.load(new URLSearchParams());
    expect(res.unavailable).toEqual(["gairmets"]);
  });
});
