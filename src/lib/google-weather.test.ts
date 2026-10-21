import { describe, expect, it } from "vitest";
import type { Forecast } from "./api/open-meteo";
import { applyGoogle, googleTypeToWmo } from "./google-weather";

// Local midnight in Chicago (UTC-5), 2026-10-12.
const T0 = Date.UTC(2026, 9, 12, 5) / 1000;

function base(): Forecast {
  const time = [T0, T0 + 3600, T0 + 7200];
  const n = (v: number) => time.map(() => v);
  return {
    lat: 35.2,
    lon: -97.4,
    elevation: 350,
    timezone: "America/Chicago",
    utcOffsetSeconds: -5 * 3600,
    fetchedAt: 0,
    current: { temp: 10, rh: 50, feelsLike: 9, isDay: 0, precip: 0, code: 3, cloud: 80, pressureMsl: 1015, surfacePressure: 980, windSpeed: 2, windDir: 90, windGust: 4, time: T0 },
    hourly: { time, temp: n(10), rh: n(50), dewPoint: n(0), feelsLike: n(9), precipProb: n(0), precip: n(0), code: n(3), cape: n(100), wind80: n(7), visibility: n(20000) } as unknown as Forecast["hourly"],
    daily: { time: [T0, T0 + 86_400], tMax: [20, 21], tMin: [5, 6], code: [3, 3], precipProbMax: [0, 0], precipSum: [0, 0], uvMax: [3, 3], gustMax: [5, 5] } as unknown as Forecast["daily"],
    minutely15: null,
  };
}

describe("Google Weather", () => {
  it("maps condition types to WMO codes", () => {
    expect(googleTypeToWmo("CLEAR")).toBe(0);
    expect(googleTypeToWmo("PARTLY_CLOUDY")).toBe(2);
    expect(googleTypeToWmo("SCATTERED_THUNDERSTORMS")).toBe(95);
    expect(googleTypeToWmo("HEAVY_RAIN")).toBe(65);
    expect(googleTypeToWmo("LIGHT_SNOW_SHOWERS")).toBe(71);
    expect(googleTypeToWmo(undefined)).toBe(3);
  });

  it("lays Google's readings over the forecast and keeps what Google doesn't give", () => {
    const current = { temperature: { degrees: 24.5 }, feelsLikeTemperature: { degrees: 25.1 }, relativeHumidity: 40, weatherCondition: { type: "CLEAR" }, wind: { speed: { value: 18 }, gust: { value: 36 }, direction: { degrees: 200 } }, isDaytime: true };
    const hours = [
      { interval: { startTime: new Date((T0 + 3600) * 1000).toISOString() }, temperature: { degrees: 22 }, precipitation: { probability: { percent: 70 }, qpf: { quantity: 2.5 } }, weatherCondition: { type: "RAIN" }, visibility: { distance: 8 } },
      { interval: { startTime: "2030-01-01T00:00:00Z" }, temperature: { degrees: 99 } }, // outside the forecast: ignored
    ];
    const days = [{ displayDate: { year: 2026, month: 10, day: 12 }, maxTemperature: { degrees: 27 }, minTemperature: { degrees: 12 }, daytimeForecast: { precipitation: { probability: { percent: 30 }, qpf: { quantity: 1 } }, weatherCondition: { type: "PARTLY_CLOUDY" } }, nighttimeForecast: { precipitation: { probability: { percent: 60 }, qpf: { quantity: 2 } } } }];
    const b = base();
    const f = applyGoogle(b, current, hours, days, 123);
    expect(f.source).toBe("google");
    expect(f.fetchedAt).toBe(123);
    expect(f.current).toMatchObject({ temp: 24.5, feelsLike: 25.1, rh: 40, code: 0, windSpeed: 5, windGust: 10, windDir: 200, isDay: 1, pressureMsl: 1015 });
    expect(f.hourly.temp).toEqual([10, 22, 10]);
    expect(f.hourly.precipProb[1]).toBe(70);
    expect(f.hourly.precip[1]).toBe(2.5);
    expect(f.hourly.code[1]).toBe(63);
    expect(f.hourly.visibility[1]).toBe(8000);
    expect(f.hourly.cape).toEqual([100, 100, 100]); // Open-Meteo's, untouched
    expect(f.daily.tMax).toEqual([27, 21]);
    expect(f.daily.precipProbMax[0]).toBe(60);
    expect(f.daily.precipSum[0]).toBe(3);
    expect(f.daily.code[0]).toBe(2);
    // The base forecast isn't modified.
    expect(b.current.temp).toBe(10);
  });

  it("puts each day on its date across a DST change", () => {
    // Fetched in PST (UTC-8); the clocks go forward on Mar 14 2027, so Mar 15 starts at 07:00 UTC.
    const b = base();
    b.timezone = "America/Los_Angeles";
    b.utcOffsetSeconds = -8 * 3600;
    b.daily = { ...b.daily, time: [Date.UTC(2027, 2, 13, 8), Date.UTC(2027, 2, 14, 8), Date.UTC(2027, 2, 15, 7)].map((ms) => ms / 1000), tMax: [10, 11, 12] };
    const day = (d: number, tMax: number) => ({ displayDate: { year: 2027, month: 3, day: d }, maxTemperature: { degrees: tMax } });
    const f = applyGoogle(b, null, [], [day(13, 20), day(14, 21), day(15, 22)]);
    expect(f.daily.tMax).toEqual([20, 21, 22]);
  });

  it("copes with empty responses", () => {
    const f = applyGoogle(base(), null, [], []);
    expect(f.current.temp).toBe(10);
    expect(f.daily.tMax).toEqual([20, 21]);
  });
});
