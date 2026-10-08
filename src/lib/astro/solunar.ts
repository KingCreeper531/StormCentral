import { moonIllumination, moonPosition } from "./moon";
import { sunCrossings } from "./sun";

/**
 * Solunar theory (Knight, 1926): fish & game are most active when the moon is
 * overhead/underfoot (major periods, ~2 h) and at moonrise/moonset (minor
 * periods, ~1 h). Periods overlapping sunrise/sunset, and days near new/full
 * moon, are rated higher.
 */
export type SolunarKind = "major" | "minor";

export interface SolunarPeriod {
  kind: SolunarKind;
  event: "transit" | "underfoot" | "moonrise" | "moonset";
  start: Date;
  peak: Date;
  end: Date;
  /** True when the period overlaps sunrise or sunset ±1 h. */
  coincidesWithSunEvent: boolean;
}

export interface SolunarForecast {
  periods: SolunarPeriod[];
  /** 1..4 day rating driven by moon phase (new/full best). */
  dayRating: 1 | 2 | 3 | 4;
}

const MOON_HORIZON_DEG = 0.133;

export function solunarForecast(start: Date, hours: number, lat: number, lon: number): SolunarForecast {
  const stepMs = 5 * 60_000;
  const t0 = start.getTime();
  const samples: { t: number; alt: number }[] = [];
  for (let t = t0 - stepMs; t <= t0 + hours * 3_600_000 + stepMs; t += stepMs) {
    samples.push({ t, alt: moonPosition(new Date(t), lat, lon).altitude });
  }

  const raw: Omit<SolunarPeriod, "coincidesWithSunEvent">[] = [];
  const window = (event: SolunarPeriod["event"], kind: SolunarKind, peak: number) => {
    const half = kind === "major" ? 60 * 60_000 : 30 * 60_000;
    raw.push({ kind, event, peak: new Date(peak), start: new Date(peak - half), end: new Date(peak + half) });
  };

  for (let i = 1; i < samples.length - 1; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    const next = samples[i + 1]!;
    if (cur.alt > prev.alt && cur.alt >= next.alt) window("transit", "major", cur.t);
    if (cur.alt < prev.alt && cur.alt <= next.alt) window("underfoot", "major", cur.t);
    const a = prev.alt - MOON_HORIZON_DEG;
    const b = cur.alt - MOON_HORIZON_DEG;
    if (Math.sign(a) !== Math.sign(b)) {
      const frac = a / (a - b);
      window(b > a ? "moonrise" : "moonset", "minor", prev.t + frac * (cur.t - prev.t));
    }
  }

  const sunEvents = sunCrossings(new Date(t0 - 3_600_000), hours + 2, lat, lon, -0.833).map((c) => c.time.getTime());
  const periods = raw
    .filter((p) => p.end.getTime() >= t0 && p.start.getTime() <= t0 + hours * 3_600_000)
    .map((p) => ({
      ...p,
      coincidesWithSunEvent: sunEvents.some(
        (s) => s >= p.start.getTime() - 3_600_000 && s <= p.end.getTime() + 3_600_000,
      ),
    }))
    .sort((a, b) => a.peak.getTime() - b.peak.getTime());

  const { phase } = moonIllumination(start);
  // Distance (in cycle fraction) to the nearest new or full moon.
  const dSyzygy = Math.min(phase, Math.abs(phase - 0.5), 1 - phase);
  const dayRating = dSyzygy < 0.04 ? 4 : dSyzygy < 0.09 ? 3 : dSyzygy < 0.17 ? 2 : 1;

  return { periods, dayRating };
}
