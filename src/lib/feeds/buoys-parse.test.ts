import { afterEach, describe, expect, it, vi } from "vitest";
import { buoysFeed } from "./buoys";
import { ndbcStationUrl, parseActiveStations, parseLatestObs } from "./buoys-parse";

// Shaped like NDBC's live files (October 2026): fixed-width columns, "MM" for missing values.
const LATEST_OBS = `#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo dy hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
41001   34.724  -72.317 2026 10 28 11 50 220   7.0   9.0  1.6    8  5.9 110 1016.5  -1.0  21.2  24.1  18.5   MM    MM
46026   37.754 -122.839 2026 10 28 11 40 310  10.0  12.0  2.9   14  8.1 295 1019.8  +0.6  13.9  14.2  11.1   MM    MM
ALSN6   40.450  -73.800 2026 10 28 12 00 360   5.1   6.2   MM   MM   MM  MM 1018.0    MM  14.8    MM    MM   MM    MM
8418150 43.656  -70.246 2026 10 28 12 00  MM    MM    MM   MM   MM   MM  MM     MM    MM    MM    MM    MM   MM   5.31
51101   24.359 -162.081 2026 10 28 02 50  70   6.0   8.0  2.1   11  6.3  20 1015.1    MM  25.0  26.4    MM   MM    MM
32ST0  -19.713  -85.585 2026 10 28 11 00 140   6.6   MM  99.0   MM   MM  MM  999.9    MM  17.6  18.2    MM   MM    MM
`;

const STATIONS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<stations created="2026-10-28T12:10:02UTC" count="3">
  <station id="41001" lat="34.724" lon="-72.317" elev="0" name="EAST HATTERAS - 150 NM East of Cape Hatteras" owner="NDBC" pgm="NDBC Meteorological/Ocean" type="buoy" met="y" currents="n" waterquality="n" dart="n"/>
  <station id="46026" lat="37.754" lon="-122.839" elev="0" name="SAN FRANCISCO - 18NM West of San Francisco, CA" owner="NDBC" pgm="NDBC Meteorological/Ocean" type="buoy" met="y" currents="n" waterquality="n" dart="n"/>
  <station id="alsn6" lat="40.450" lon="-73.800" elev="47.5" name="Ambrose Light, NY" owner="NDBC" pgm="NDBC Meteorological/Ocean" type="fixed" met="y" currents="n" waterquality="n" dart="n"/>
  <station id="32st0" lat="-19.713" lon="-85.585" name="Stratus &amp; Ocean Reference" owner="WHOI" pgm="IOOS Partners" type="other" met="y" currents="n" waterquality="n" dart="n"/>
</stations>`;

const NOW = Date.parse("2026-10-28T12:10:00Z");

describe("parseActiveStations", () => {
  it("names stations by upper-case id, title-casing names written in capitals", () => {
    const m = parseActiveStations(STATIONS_XML);
    expect(m.get("41001")).toEqual({ name: "East Hatteras - 150 NM East of Cape Hatteras", kind: "buoy" });
    expect(m.get("46026")?.name).toBe("San Francisco - 18NM West of San Francisco, CA");
    expect(m.get("ALSN6")).toEqual({ name: "Ambrose Light, NY", kind: "station" });
    expect(m.get("32ST0")?.name).toBe("Stratus & Ocean Reference");
    expect(parseActiveStations("not xml").size).toBe(0);
  });
});

describe("parseLatestObs", () => {
  const buoys = parseLatestObs(LATEST_OBS, parseActiveStations(STATIONS_XML), NOW);

  it("reads every column by its header name, in SI", () => {
    expect(buoys[0]).toEqual({
      id: "41001",
      name: "East Hatteras - 150 NM East of Cape Hatteras",
      kind: "buoy",
      lat: 34.724,
      lon: -72.317,
      time: "2026-10-28T11:50:00.000Z",
      waveHeight: 1.6,
      dominantPeriod: 8,
      waveDir: 110,
      windDir: 220,
      windSpeed: 7,
      gust: 9,
      pressure: 1016.5,
      airTemp: 21.2,
      waterTemp: 24.1,
    });
  });

  it("keeps stations without waves, with missing values as null and 360° as north", () => {
    const alsn6 = buoys.find((b) => b.id === "ALSN6")!;
    expect(alsn6).toMatchObject({ kind: "station", waveHeight: null, dominantPeriod: null, waveDir: null, windDir: 0, windSpeed: 5.1, waterTemp: null });
  });

  it("drops water-level gauges with nothing else, stale reports and impossible values", () => {
    expect(buoys.map((b) => b.id)).toEqual(["41001", "46026", "ALSN6", "32ST0"]);
    // Some partner buoys write 99.0 for "no waves"; 999.9 hPa is a real (stormy) pressure.
    expect(buoys.find((b) => b.id === "32ST0")).toMatchObject({ waveHeight: null, pressure: 999.9 });
  });

  it("names stations missing from the station list by their id", () => {
    expect(parseLatestObs(LATEST_OBS, new Map(), NOW)[0]).toMatchObject({ name: "Station 41001", kind: "station" });
  });

  it("falls back to NDBC's column order when the header is missing", () => {
    const body = LATEST_OBS.split("\n").filter((l) => !l.startsWith("#")).join("\n");
    expect(parseLatestObs(body, new Map(), NOW)[1]).toMatchObject({ id: "46026", waveHeight: 2.9, dominantPeriod: 14, waveDir: 295, gust: 12 });
  });

  it("follows the header when columns move", () => {
    const moved = "#STN LAT LON YYYY MM DD hh mm WVHT WSPD\n#text deg deg yr mo dy hr mn m m/s\n41001 34.7 -72.3 2026 10 28 12 00 3.2 MM\n";
    expect(parseLatestObs(moved, new Map(), NOW)).toMatchObject([{ waveHeight: 3.2, windSpeed: null, gust: null }]);
  });

  it("links each station to its NDBC page", () => {
    expect(ndbcStationUrl("ALSN6")).toBe("https://www.ndbc.noaa.gov/station_page.php?station=alsn6");
  });
});

describe("buoysFeed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("still lists the stations, named by id, when the station list fails", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("latest_obs.txt") ? new Response(LATEST_OBS) : new Response("busy", { status: 503 }),
      ),
    );
    try {
      const r = await buoysFeed.load(new URLSearchParams());
      expect(r.buoys.map((b) => b.name)).toEqual(["Station 41001", "Station 46026", "Station ALSN6", "Station 32ST0"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
