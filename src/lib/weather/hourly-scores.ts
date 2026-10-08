/**
 * Per-hour mode scores shared by the UI and the alert engine, so a custom
 * alert ("bite index above 70") fires on exactly the number the Angler mode
 * shows. Pure: no Intl, no DOM; it also runs in the Android background runner.
 */
import type { Forecast } from "../api/open-meteo";
import { solunarForecast, type SolunarForecast, type SolunarPeriod } from "../astro/solunar";
import { skyPhase, sunCrossings, sunPosition } from "../astro/sun";
import { estimateCeiling, estimateWaterTempC } from "../science/atmosphere";
import { tendencyAt } from "../science/pressure";
import { biteIndex, droneFlyability, type BiteIndex, type DroneProfile, type ScoreResult } from "../science/scores";
import { windAtHeight, type WindSample } from "../science/wind";
import { mean } from "../utils";
import { currentHourIndex, hourRange } from "./view";

/** Heights (m) with model wind levels. */
export const WIND_LEVELS = [10, 80, 120, 180] as const;

/** Wind profile at hour `i` (levels with missing data are skipped). */
export function windProfileAt(f: Forecast, i: number): WindSample[] {
  const speeds = [f.hourly.wind10, f.hourly.wind80, f.hourly.wind120, f.hourly.wind180];
  const dirs = [f.hourly.dir10, f.hourly.dir80, f.hourly.dir120, f.hourly.dir180];
  return WIND_LEVELS.flatMap((h, k) => {
    const s = speeds[k]![i];
    const d = dirs[k]![i];
    return s != null && d != null ? [{ heightM: h, speedMs: s, dirDeg: d }] : [];
  });
}

/** Hours from the nearest sunrise or sunset. */
export function hoursFromSunEvent(t: number, events: readonly number[]) {
  return events.length ? Math.min(...events.map((e) => Math.abs(e - t))) / 3_600_000 : 99;
}

export interface FlyabilityInputs {
  altitudeM: number;
  profile: DroneProfile;
  lat: number;
  lon: number;
  /** Planetary Kp for the hour, when known. */
  kp?: number | null;
  /** Satellites above the 10° mask, when known. */
  satellitesVisible?: number | null;
}

/** UAV flyability for hour `i`, plus the intermediate values the UAV mode charts. */
export function flyabilityAt(f: Forecast, i: number, o: FlyabilityInputs) {
  const t = f.hourly.time[i]! * 1000;
  const prof = windProfileAt(f, i);
  const atAlt = windAtHeight(prof, o.altitudeM);
  const gust = f.hourly.gust10[i] ?? 0;
  // Gusts scale up with height roughly like the mean wind does.
  const gustAtAlt = atAlt && prof[0] ? gust * Math.max(1, atAlt.speedMs / Math.max(0.5, prof[0].speedMs)) : gust;
  const ceiling = estimateCeiling({
    tempC: f.hourly.temp[i] ?? 15,
    dewPointC: f.hourly.dewPoint[i] ?? 5,
    lowPct: f.hourly.cloudLow[i] ?? 0,
    midPct: f.hourly.cloudMid[i] ?? 0,
    highPct: f.hourly.cloudHigh[i] ?? 0,
  });
  const result: ScoreResult = droneFlyability(
    {
      windAtAltitudeMs: atAlt?.speedMs ?? f.hourly.wind10[i] ?? 0,
      gustMs: gustAtAlt,
      precipProbPct: f.hourly.precipProb[i] ?? 0,
      precipMm: f.hourly.precip[i] ?? 0,
      visibilityM: f.hourly.visibility[i] ?? null,
      ceilingM: ceiling.baseM,
      flightAltitudeM: o.altitudeM,
      tempC: f.hourly.temp[i] ?? 15,
      kp: o.kp ?? null,
      skyPhase: skyPhase(sunPosition(new Date(t + 1_800_000), o.lat, o.lon).altitude),
      satellitesVisible: o.satellitesVisible ?? null,
    },
    o.profile,
  );
  return { t, prof, atAlt, gustAtAlt, ceiling, result };
}

export interface AnglerModel {
  solunar: SolunarForecast;
  hours: { i: number; t: number; bite: BiteIndex }[];
  waterTemp: number | null;
  waterTempIsEstimate: boolean;
}

/** Bite index for the next `count` hours (the Angler mode's model). */
export function anglerModel(
  f: Forecast,
  now: number,
  lat: number,
  lon: number,
  opts: { count?: number; gaugeWaterTempC?: number | null; flowChange24h?: number | null } = {},
): AnglerModel {
  const solunar = solunarForecast(new Date(now - 2 * 3_600_000), 30, lat, lon);
  const sunEvents = sunCrossings(new Date(now - 3_600_000), 30, lat, lon, -0.833).map((c) => c.time.getTime());
  const i0 = currentHourIndex(f, now);
  const airMean = mean(f.hourly.temp.slice(Math.max(0, i0 - 24), i0 + 1));
  const gaugeTemp = opts.gaugeWaterTempC ?? null;
  const waterTemp = gaugeTemp ?? (Number.isFinite(airMean) ? estimateWaterTempC(airMean) : null);
  const inPeriod = (t: number, kind: SolunarPeriod["kind"]) => solunar.periods.some((p) => p.kind === kind && t >= p.start.getTime() && t <= p.end.getTime());

  const hours = hourRange(f, now, opts.count ?? 24).idx.map((i) => {
    const t = f.hourly.time[i]! * 1000;
    const bite = biteIndex({
      tendency: tendencyAt(f.hourly.pressureMsl, i),
      inMajorPeriod: inPeriod(t + 1_800_000, "major"),
      inMinorPeriod: inPeriod(t + 1_800_000, "minor"),
      solunarDayRating: solunar.dayRating,
      hoursFromSunEvent: hoursFromSunEvent(t + 1_800_000, sunEvents),
      cloudPct: f.hourly.cloud[i] ?? 0,
      windMs: f.hourly.wind10[i] ?? 0,
      waterTempC: waterTemp,
      weatherCode: f.hourly.code[i] ?? 0,
      flowChange24h: opts.flowChange24h ?? null,
    });
    return { i, t, bite };
  });
  return { solunar, hours, waterTemp, waterTempIsEstimate: gaugeTemp == null };
}
