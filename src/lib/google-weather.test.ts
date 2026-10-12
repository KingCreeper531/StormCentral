import { describe, expect, it } from "vitest";
import { googleTypeToWmo, parseGoogleCurrent, parseGoogleDays, parseGoogleHours, parseGoogleTimeZone, parseModel } from "./google-weather";

describe("Google Weather parsing", () => {
  it("maps condition types to WMO codes", () => {
    expect(googleTypeToWmo("CLEAR")).toBe(0);
    expect(googleTypeToWmo("PARTLY_CLOUDY")).toBe(2);
    expect(googleTypeToWmo("SCATTERED_THUNDERSTORMS")).toBe(95);
    expect(googleTypeToWmo("HEAVY_RAIN")).toBe(65);
    expect(googleTypeToWmo("LIGHT_SNOW_SHOWERS")).toBe(71);
    expect(googleTypeToWmo(undefined)).toBe(3);
  });

  it("reads current conditions, hours and days defensively", () => {
    const current = {
      timeZone: { id: "America/Chicago" },
      isDaytime: true,
      weatherCondition: { type: "MOSTLY_CLEAR", description: { text: "Mostly sunny" } },
      temperature: { degrees: 24.5, unit: "CELSIUS" },
      feelsLikeTemperature: { degrees: 25.1 },
      relativeHumidity: 40,
      wind: { speed: { value: 18, unit: "KILOMETERS_PER_HOUR" }, gust: { value: 36 }, direction: { degrees: 180 } },
      precipitation: { probability: { percent: 10, type: "RAIN" } },
      thunderstormProbability: 0,
    };
    const c = parseGoogleCurrent(current)!;
    expect(c).toMatchObject({ tempC: 24.5, text: "Mostly sunny", code: 1, windMs: 5, gustMs: 10, precipChance: 10 });
    expect(parseGoogleTimeZone({}, current)).toBe("America/Chicago");

    const hours = parseGoogleHours({
      forecastHours: [
        { interval: { startTime: "2026-10-12T15:00:00Z" }, temperature: { degrees: 20 }, weatherCondition: { type: "RAIN" }, precipitation: { probability: { percent: 70 }, qpf: { quantity: 1.2 } } },
        { interval: {}, temperature: { degrees: 19 } },
      ],
    });
    expect(hours).toEqual([{ time: "2026-10-12T15:00:00Z", tempC: 20, code: 63, text: null, isDay: true, precipChance: 70, precipMm: 1.2 }]);

    const days = parseGoogleDays({
      forecastDays: [
        {
          displayDate: { year: 2026, month: 10, day: 12 },
          maxTemperature: { degrees: 28 },
          minTemperature: { degrees: 14 },
          daytimeForecast: { weatherCondition: { type: "THUNDERSTORM", description: { text: "Thunderstorms" } }, precipitation: { probability: { percent: 60 } } },
          nighttimeForecast: { precipitation: { probability: { percent: 80 } } },
        },
      ],
    });
    expect(days).toEqual([{ date: "2026-10-12", hiC: 28, loC: 14, code: 95, text: "Thunderstorms", precipChance: 80 }]);
    expect(parseGoogleCurrent(null)).toBeNull();
    expect(parseGoogleDays({})).toEqual([]);
  });

  it("reads any Open-Meteo model (here 6-hourly) into the same shape", () => {
    const t0 = Date.parse("2026-10-12T06:00:00Z") / 1000; // 1 AM at UTC-5
    const time = Array.from({ length: 12 }, (_, i) => t0 + i * 3600);
    const raw = {
      timezone: "America/Chicago",
      utc_offset_seconds: -5 * 3600,
      hourly: {
        time,
        temperature_2m: time.map((_, i) => (i % 6 === 0 ? 10 + i : null)),
        precipitation: time.map((_, i) => (i === 6 ? 3 : 0)),
        precipitation_probability: time.map((_, i) => (i === 6 ? 70 : null)),
        weather_code: time.map(() => null),
        cloud_cover: time.map(() => 90),
      },
    };
    const g = parseModel(raw, t0 * 1000)!;
    expect(g.source).toBe("model");
    expect(g.stepHours).toBe(6);
    expect(g.hours).toHaveLength(2);
    expect(g.hours[1]).toMatchObject({ tempC: 16, precipMm: 3, code: 63, precipChance: 70 });
    expect(g.days[0]).toMatchObject({ date: "2026-10-12", hiC: 16, loC: 10, precipChance: 70, precipMm: 3 });
    expect(g.current?.tempC).toBe(10);
    expect(parseModel({}, 0)).toBeNull();
  });
});
