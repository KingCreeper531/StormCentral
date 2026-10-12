import type { AirQuality, Forecast } from "./api/open-meteo";

/**
 * Fire weather and smoke from the forecast. The levels follow the shape of
 * NWS Red Flag criteria (very low humidity together with strong wind, hour by
 * hour), softened after soaking rain. They are guidance, not the official
 * fire danger rating, which comes from the local NWS office's warnings.
 */
export const FIRE_LEVELS = ["Low", "Elevated", "Critical", "Extreme"] as const;
export type FireLevel = 0 | 1 | 2 | 3;

/** 20 mph sustained / 25, 35, 50 mph gusts, in m/s. */
const MPH = 0.44704;

export function hourFireLevel(rh: number | null, wind: number | null, gust: number | null): FireLevel {
  if (rh == null) return 0;
  const w = wind ?? 0;
  const g = gust ?? w;
  if (rh <= 10 && (w >= 25 * MPH || g >= 50 * MPH)) return 3;
  if (rh <= 15 && (w >= 20 * MPH || g >= 35 * MPH)) return 2;
  if ((rh <= 25 && (w >= 15 * MPH || g >= 25 * MPH)) || (rh <= 15 && g >= 15 * MPH)) return 1;
  return 0;
}

export interface FireDay {
  /** Epoch ms of local midnight. */
  time: number;
  level: FireLevel;
  minRh: number | null;
  maxGust: number | null;
  maxTemp: number | null;
  rainMm: number;
}

/**
 * The next `days` days' fire-weather level. A level needs at least two hours
 * meeting it; a wet day (≥ 2.5 mm) or a soaking in the 48 h before
 * (≥ 10 mm) drops it one step.
 */
export function fireDays(f: Forecast, nowMs: number, days = 3): FireDay[] {
  const { time: dTime } = f.daily;
  const h = f.hourly;
  let start = dTime.findLastIndex((t) => t * 1000 <= nowMs);
  if (start < 0) start = 0;
  const out: FireDay[] = [];
  for (let d = start; d < Math.min(dTime.length, start + days); d++) {
    const from = dTime[d]! * 1000;
    const to = d + 1 < dTime.length ? dTime[d + 1]! * 1000 : from + 86_400_000;
    const counts = [0, 0, 0, 0];
    let minRh: number | null = null;
    let maxGust: number | null = null;
    let maxTemp: number | null = null;
    let rain = 0;
    let before = 0;
    for (let i = 0; i < h.time.length; i++) {
      const t = h.time[i]! * 1000;
      if (t > from - 48 * 3_600_000 && t <= from) before += h.precip[i] ?? 0;
      if (t < from || t >= to) continue;
      const rh = h.rh[i] ?? null;
      const gust = h.gust10[i] ?? null;
      const temp = h.temp[i] ?? null;
      rain += h.precip[i] ?? 0;
      if (rh != null) minRh = minRh == null ? rh : Math.min(minRh, rh);
      if (gust != null) maxGust = maxGust == null ? gust : Math.max(maxGust, gust);
      if (temp != null) maxTemp = maxTemp == null ? temp : Math.max(maxTemp, temp);
      const lvl = hourFireLevel(rh, h.wind10[i] ?? null, gust);
      for (let k = 1; k <= lvl; k++) counts[k]! += 1;
    }
    let level = ([3, 2, 1].find((k) => counts[k]! >= 2) ?? 0) as FireLevel;
    if (level > 0 && (rain >= 2.5 || before >= 10)) level = (level - 1) as FireLevel;
    out.push({ time: from, level, minRh, maxGust, maxTemp, rainMm: rain });
  }
  return out;
}

export interface SmokeOutlook {
  /** PM2.5 now, µg/m³. */
  now: number | null;
  /** Highest PM2.5 in the next 48 h and when. */
  peak: number | null;
  peakTime: number | null;
  /** Aerosol optical depth now (smoke or dust anywhere in the column). */
  aod: number | null;
  label: string;
  detail: string;
}

/** Plain-language smoke and haze from PM2.5 (ground level) and AOD (the whole sky). */
export function smokeOutlook(a: AirQuality, nowMs: number): SmokeOutlook {
  const { time, pm25, aod } = a.hourly;
  let i0 = -1;
  for (let i = 0; i < time.length; i++) if (time[i]! * 1000 <= nowMs) i0 = i;
  const now = i0 >= 0 ? (pm25[i0] ?? null) : null;
  const aodNow = i0 >= 0 ? (aod[i0] ?? null) : null;
  let peak: number | null = null;
  let peakTime: number | null = null;
  for (let i = Math.max(0, i0); i < time.length && time[i]! * 1000 <= nowMs + 48 * 3_600_000; i++) {
    const v = pm25[i];
    if (v != null && (peak == null || v > peak)) {
      peak = v;
      peakTime = time[i]! * 1000;
    }
  }
  const pm = now ?? 0;
  const [label, detail] =
    pm > 125.4
      ? ["Heavy smoke", "Very unhealthy air. Stay indoors with windows closed and filter the air if you can."]
      : pm > 55.4
        ? ["Very smoky", "Unhealthy air for everyone. Limit time outside."]
        : pm > 35.4
          ? ["Smoky", "Unhealthy for sensitive groups. Consider a mask outside if you have asthma or heart disease."]
          : pm > 9
            ? ["Mostly clear", "Slightly elevated particles; only unusually sensitive people are likely to notice."]
            : (aodNow ?? 0) >= 0.5
              ? ["Hazy sky", "Smoke or dust high overhead: hazy skies and vivid sunsets, but the air at ground level is fine."]
              : ["Clear air", "No smoke or haze to speak of."];
  return { now, peak, peakTime, aod: aodNow, label, detail };
}
