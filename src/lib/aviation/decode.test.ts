import { describe, expect, it } from "vitest";
import { translator } from "../i18n/core";
import { ceilingOf, decodeMetar, decodeTaf, flightCategory, formatSm, parseWeather, resolveDayTime, tafPeriodAt, weatherText, type WxGroup } from "./decode";

// Reports in the formats aviationweather.gov serves (rawOb / rawTAF), US and ICAO.
const REF = Date.UTC(2026, 9, 20, 18, 0);
const at = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h, m);
const wx = (code: string) => parseWeather(code) as WxGroup;

describe("flightCategory", () => {
  it("takes the worse of ceiling and visibility, on the FAA's boundaries", () => {
    expect(flightCategory(null, 10)).toBe("VFR");
    expect(flightCategory(3100, 6)).toBe("VFR");
    expect(flightCategory(3000, 10)).toBe("MVFR");
    expect(flightCategory(1000, 10)).toBe("MVFR");
    expect(flightCategory(null, 5)).toBe("MVFR");
    expect(flightCategory(null, 3)).toBe("MVFR");
    expect(flightCategory(999, 10)).toBe("IFR");
    expect(flightCategory(500, 10)).toBe("IFR");
    expect(flightCategory(5000, 2.5)).toBe("IFR");
    expect(flightCategory(null, 1)).toBe("IFR");
    expect(flightCategory(499, 10)).toBe("LIFR");
    expect(flightCategory(5000, 0.75)).toBe("LIFR");
    expect(flightCategory(2000, 0.5)).toBe("LIFR");
  });

  it("gives none without a visibility", () => {
    expect(flightCategory(800, null)).toBeNull();
    expect(flightCategory(null, null)).toBeNull();
  });
});

describe("decodeMetar", () => {
  it("reads a routine US report", () => {
    const m = decodeMetar("METAR KOKC 201752Z 18012G20KT 10SM FEW250 23/11 A2998 RMK AO2 SLP141 T02280106 10228 20150 58012", REF)!;
    expect(m).toMatchObject({
      station: "KOKC",
      type: "METAR",
      time: at(20, 17, 52),
      auto: false,
      wind: { dirDeg: 180, variable: false, speedKt: 12, gustKt: 20, varFromDeg: null, varToDeg: null },
      visibility: { sm: 10, plus: false, minus: false, meters: null },
      clouds: [{ cover: "FEW", baseFt: 25_000, type: null }],
      tempC: 23,
      dewpointC: 11,
      altimeter: { value: 29.98, unit: "inHg" },
      ceilingFt: null,
      category: "VFR",
      remarks: "RMK AO2 SLP141 T02280106 10228 20150 58012",
      unparsed: [],
    });
  });

  it("reads a SPECI with a mixed-number visibility and low cloud (IFR)", () => {
    const m = decodeMetar("SPECI KJFK 121851Z 04015G25KT 1 1/2SM -RA BR BKN006 OVC012 08/07 A2972 RMK AO2 PK WND 04030/1830 P0012", Date.UTC(2026, 9, 12, 19))!;
    expect(m.type).toBe("SPECI");
    expect(m.visibility?.sm).toBe(1.5);
    expect(m.weather.map((w) => w.code)).toEqual(["-RA", "BR"]);
    expect(m.ceilingFt).toBe(600);
    expect(m.category).toBe("IFR");
    expect(m.unparsed).toEqual([]);
  });

  it("counts vertical visibility as the ceiling (fog, LIFR)", () => {
    const m = decodeMetar("METAR KSFO 110556Z 28008KT 1/4SM FG VV002 12/12 A3001 RMK AO2", Date.UTC(2026, 9, 11, 6))!;
    expect(m.visibility?.sm).toBe(0.25);
    expect(m.clouds).toEqual([{ cover: "VV", baseFt: 200, type: null }]);
    expect(m.ceilingFt).toBe(200);
    expect(m.category).toBe("LIFR");
  });

  it("reads variable wind, negative temperatures and several layers (MVFR)", () => {
    const m = decodeMetar("METAR KDEN 151953Z VRB03KT 4SM -SN BR SCT015 BKN025 OVC040 M02/M04 A3012 RMK AO2 SLP248", Date.UTC(2026, 9, 15, 20))!;
    expect(m.wind).toMatchObject({ dirDeg: null, variable: true, speedKt: 3, gustKt: null });
    expect(m.tempC).toBe(-2);
    expect(m.dewpointC).toBe(-4);
    expect(ceilingOf(m.clouds)).toBe(2500);
    expect(m.category).toBe("MVFR");
  });

  it("reads calm wind, AUTO and a clear sky", () => {
    const m = decodeMetar("METAR KOUN 202358Z AUTO 00000KT 10SM CLR 18/03 A3001 RMK AO2", REF)!;
    expect(m.auto).toBe(true);
    expect(m.wind).toMatchObject({ dirDeg: null, variable: false, speedKt: 0 });
    expect(m.skyClear).toBe(true);
    expect(m.category).toBe("VFR");
  });

  it("reads thunderstorms with hail, a varying wind and cumulonimbus", () => {
    const m = decodeMetar("METAR KTUL 202153Z 22018G32KT 180V250 2SM +TSRAGR SCT020CB BKN035 OVC080 21/19 A2975 RMK AO2 PK WND 23045/2137 TSB45", REF)!;
    expect(m.wind).toMatchObject({ dirDeg: 220, speedKt: 18, gustKt: 32, varFromDeg: 180, varToDeg: 250 });
    expect(m.weather).toEqual([{ code: "+TSRAGR", intensity: "heavy", descriptor: "TS", phenomena: ["RA", "GR"] }]);
    expect(m.clouds[0]).toEqual({ cover: "SCT", baseFt: 2000, type: "CB" });
    expect(m.category).toBe("IFR");
  });

  it("skips runway visual range and reads freezing fog", () => {
    const m = decodeMetar("METAR KORD 201751Z 27010KT 1/2SM R28L/2400FT FZFG OVC002 M01/M01 A3005 RMK AO2", REF)!;
    expect(m.weather.map((w) => w.code)).toEqual(["FZFG"]);
    expect(m.unparsed).toEqual([]);
    expect(m.category).toBe("LIFR");
  });

  it("reads less-than and more-than visibilities", () => {
    expect(decodeMetar("METAR KBTV 201754Z 36005KT M1/4SM FG VV001 02/02 A3010", REF)?.visibility).toEqual({ sm: 0.25, plus: false, minus: true, meters: null });
    expect(decodeMetar("METAR KAUS 201751Z 16009KT P6SM SKC 29/14 A2994", REF)?.visibility).toEqual({ sm: 6, plus: true, minus: false, meters: null });
  });

  it("reads ICAO reports: metres, Q altimeter, CAVOK, m/s wind, and stops at the trend", () => {
    const egll = decodeMetar("METAR EGLL 201750Z 24015KT 9999 SCT030 BKN045 14/09 Q1012 NOSIG", REF)!;
    expect(egll.visibility).toMatchObject({ plus: true, meters: 9999 });
    expect(egll.altimeter).toEqual({ value: 1012, unit: "hPa" });
    expect(egll.category).toBe("VFR");

    const lfpg = decodeMetar("METAR LFPG 201800Z 05005KT CAVOK 08/02 Q1030 NOSIG", REF)!;
    expect(lfpg.cavok).toBe(true);
    expect(lfpg.category).toBe("VFR");

    const uuee = decodeMetar("METAR UUEE 201800Z 33004MPS 2000 -SN BR OVC006 M03/M05 Q1015 TEMPO 1000 SN", REF)!;
    expect(uuee.wind?.speedKt).toBe(8);
    expect(uuee.visibility?.meters).toBe(2000);
    expect(uuee.weather.map((w) => w.code)).toEqual(["-SN", "BR"]);
    expect(uuee.category).toBe("IFR");
  });

  it("gives no category when the visibility sensor is out", () => {
    const m = decodeMetar("METAR KGUY 201755Z AUTO 18010KT BKN008 20/18 A2990 RMK AO2 VISNO", REF)!;
    expect(m.visibility).toBeNull();
    expect(m.ceilingFt).toBe(800);
    expect(m.category).toBeNull();
  });

  it("reads a missing dew point, and places a report from the 31st read on the 1st in the month before", () => {
    const m = decodeMetar("METAR PAFA 312353Z 00000KT 10SM SKC M25/ A3045", Date.UTC(2026, 10, 1, 0, 10))!;
    expect(m.tempC).toBe(-25);
    expect(m.dewpointC).toBeNull();
    expect(m.time).toBe(Date.UTC(2026, 9, 31, 23, 53));
  });

  it("rejects text that isn't a report", () => {
    expect(decodeMetar("")).toBeNull();
    expect(decodeMetar("NO DATA")).toBeNull();
  });
});

describe("decodeTaf", () => {
  const OKC =
    "TAF KOKC 201720Z 2018/2118 18012G22KT P6SM SCT250 FM210000 17008KT P6SM BKN100 TEMPO 2106/2110 VRB05KT 3SM TSRA BKN030CB PROB30 2112/2116 2SM BR OVC008 FM211500 20010KT P6SM SCT040";

  it("splits a US TAF into its periods, FM periods running to the next", () => {
    const taf = decodeTaf(OKC, REF)!;
    expect(taf).toMatchObject({ station: "KOKC", amended: false, issued: at(20, 17, 20), from: at(20, 18), to: at(21, 18) });
    expect(taf.periods.map((p) => [p.change, p.from, p.to, p.category])).toEqual([
      ["base", at(20, 18), at(21, 0), "VFR"],
      ["from", at(21, 0), at(21, 15), "VFR"],
      ["temporary", at(21, 6), at(21, 10), "MVFR"],
      ["probability", at(21, 12), at(21, 16), "IFR"],
      ["from", at(21, 15), at(21, 18), "VFR"],
    ]);
    expect(taf.periods[0]!.raw).toBe("18012G22KT P6SM SCT250");
    expect(taf.periods[2]).toMatchObject({ raw: "TEMPO 2106/2110 VRB05KT 3SM TSRA BKN030CB", ceilingFt: 3000, temporary: true });
    expect(taf.periods[3]).toMatchObject({ probability: 30, temporary: false, ceilingFt: 800 });
  });

  it("finds the forecast in effect at a time", () => {
    const taf = decodeTaf(OKC, REF)!;
    expect(tafPeriodAt(taf, at(20, 20))?.change).toBe("base");
    expect(tafPeriodAt(taf, at(21, 8))?.from).toBe(at(21, 0));
  });

  it("reads an amended TAF, wind shear, VCTS and validity to hour 24", () => {
    const taf = decodeTaf("TAF AMD KDFW 202005Z 2020/2124 19015G25KT P6SM VCTS BKN050CB WS020/24045KT FM202300 18012KT P6SM SCT050 BKN250", REF)!;
    expect(taf.amended).toBe(true);
    expect(taf.to).toBe(at(22, 0));
    expect(taf.periods[0]).toMatchObject({ windShear: { heightFt: 2000, dirDeg: 240, speedKt: 45 }, category: "VFR" });
    expect(weatherText(taf.periods[0]!.weather[0]!)).toBe("Thunderstorm nearby");
    expect(taf.periods[1]!.from).toBe(at(20, 23));
  });

  it("reads an ICAO TAF: BECMG keeps the forecast's cloud, PROB30 TEMPO in metres", () => {
    const taf = decodeTaf("TAF EGLL 201700Z 2018/2124 24012KT 9999 BKN035 BECMG 2100/2103 VRB03KT TEMPO 2103/2109 4000 BR BKN008 PROB30 TEMPO 2106/2109 0800 FG BKN002", REF)!;
    expect(taf.periods.map((p) => [p.change, p.probability, p.temporary, p.category])).toEqual([
      ["base", null, false, "VFR"],
      ["becoming", null, false, "VFR"],
      ["temporary", null, true, "IFR"],
      ["probability", 30, true, "LIFR"],
    ]);
    expect(taf.periods[3]!.from).toBe(at(21, 6));
  });

  it("places validity across a month end", () => {
    const taf = decodeTaf("TAF KMKE 312330Z 0100/0206 27010KT P6SM SKC", Date.UTC(2026, 10, 1, 0, 10))!;
    expect(taf.issued).toBe(Date.UTC(2026, 9, 31, 23, 30));
    expect(taf.from).toBe(Date.UTC(2026, 10, 1, 0));
    expect(taf.to).toBe(Date.UTC(2026, 10, 2, 6));
  });

  it("keeps remarks apart and rejects NIL or broken TAFs", () => {
    expect(decodeTaf("TAF KOFF 201720Z 2018/2118 18010KT P6SM SKC RMK NXT FCST BY 21Z", REF)?.remarks).toBe("RMK NXT FCST BY 21Z");
    expect(decodeTaf("TAF KXYZ 201720Z NIL", REF)).toBeNull();
    expect(decodeTaf("hello", REF)).toBeNull();
  });
});

describe("resolveDayTime", () => {
  it("picks the month that puts the day nearest the reference", () => {
    expect(resolveDayTime(20, 18, 0, REF)).toBe(at(20, 18));
    expect(resolveDayTime(1, 0, 0, Date.UTC(2026, 9, 31, 22))).toBe(Date.UTC(2026, 10, 1));
    expect(resolveDayTime(30, 23, 0, Date.UTC(2026, 11, 1, 1))).toBe(Date.UTC(2026, 10, 30, 23));
    // A day the month doesn't have never rolls into the next month (November 31 isn't December 1).
    expect(resolveDayTime(31, 12, 0, Date.UTC(2026, 10, 15))).not.toBe(Date.UTC(2026, 11, 1, 12));
    expect(resolveDayTime(32, 0, 0, REF)).toBeNull();
  });
});

describe("weatherText", () => {
  it("says the weather in words", () => {
    expect(weatherText(wx("-RA"))).toBe("Light rain");
    expect(weatherText(wx("+TSRAGR"))).toBe("Thunderstorm with heavy rain and hail");
    expect(weatherText(wx("-TSRA"))).toBe("Thunderstorm with light rain");
    expect(weatherText(wx("TS"))).toBe("Thunderstorm");
    expect(weatherText(wx("VCSH"))).toBe("Showers nearby");
    expect(weatherText(wx("-SHRASN"))).toBe("Light rain and snow showers");
    expect(weatherText(wx("FZFG"))).toBe("Freezing fog");
    expect(weatherText(wx("-FZDZ"))).toBe("Light freezing drizzle");
    expect(weatherText(wx("BLSN"))).toBe("Blowing snow");
    expect(weatherText(wx("BCFG"))).toBe("Patches of fog");
    expect(weatherText(wx("BR"))).toBe("Mist");
    expect(weatherText(wx("+FC"))).toBe("Tornado or waterspout");
  });

  it("in Spanish", () => {
    const es = translator("es");
    expect(weatherText(wx("-RA"), es)).toBe("Lluvia débil");
    expect(weatherText(wx("+TSRA"), es)).toBe("Tormenta eléctrica con lluvia fuerte");
    expect(weatherText(wx("FZFG"), es)).toBe("Niebla engelante");
  });

  it("only reads weather groups", () => {
    expect(parseWeather("-")).toBeNull();
    expect(parseWeather("VC")).toBeNull();
    expect(parseWeather("A2992")).toBeNull();
    expect(parseWeather("SKC")).toBeNull();
  });
});

describe("formatSm", () => {
  it("writes statute miles as pilots do", () => {
    expect(formatSm(10)).toBe("10");
    expect(formatSm(1.5)).toBe("1 1/2");
    expect(formatSm(0.75)).toBe("3/4");
    expect(formatSm(2.25)).toBe("2 1/4");
    expect(formatSm(1 / 16)).toBe("1/16");
    expect(formatSm(1.24)).toBe("1.2");
  });
});
