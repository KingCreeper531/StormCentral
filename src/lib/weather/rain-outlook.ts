/**
 * What the next three hours of 15-minute precipitation say: dry, rain on the
 * way (when, how hard, for how long), or raining now (until when). Shared by
 * the Daily page's nowcast card, the rain-soon notification and, in Java,
 * the Android check (AlertsWorker.rainOutlook); keep them in step.
 *
 * Open-Meteo's 15-minute precipitation is the total for the 15 minutes
 * BEFORE each timestamp, so slot i covers [t[i] - 15 min, t[i]).
 */

export const SLOT_MS = 15 * 60_000;
/** Below this many mm in 15 minutes it's dry (a trace the forecast can't place). */
export const WET_MM = 0.1;

export type RainIntensity = "light" | "moderate" | "heavy";

export interface RainOutlook {
  state: "dry" | "starting" | "wet";
  /** Minutes until it starts (0 when it's about to); null unless `starting`. */
  startsInMin: number | null;
  /** Minutes until it stops; null when it goes past the end of the forecast. */
  endsInMin: number | null;
  /** Heaviest 15 minutes of this spell, mm. */
  peakMm: number;
  intensity: RainIntensity;
  /** Minutes of forecast ahead of now. */
  horizonMin: number;
}

/** Per 15 minutes: under 0.6 mm (≈2.5 mm/h) light, under 2 mm (≈8 mm/h) moderate, more is heavy. */
export function intensityOf(mmPer15: number): RainIntensity {
  return mmPer15 < 0.6 ? "light" : mmPer15 < 2 ? "moderate" : "heavy";
}

/**
 * @param times epoch seconds (end of each 15-minute slot)
 * @param precip mm in each slot
 */
export function rainOutlook(times: readonly number[], precip: readonly (number | null)[], now: number): RainOutlook | null {
  // The slot we're in: the first that ends after now.
  const first = times.findIndex((t) => t * 1000 > now);
  if (first < 0) return null;
  const end = Math.min(times.length, precip.length);
  const wet = (i: number) => (precip[i] ?? 0) >= WET_MM;
  const horizonMin = Math.max(0, Math.round((times[end - 1]! * 1000 - now) / 60_000));
  const minsTo = (ms: number) => Math.max(0, Math.round((ms - now) / 60_000));

  let start = first;
  while (start < end && !wet(start)) start++;
  if (start >= end) return { state: "dry", startsInMin: null, endsInMin: null, peakMm: 0, intensity: "light", horizonMin };

  let stop = start;
  let peak = 0;
  while (stop < end && wet(stop)) peak = Math.max(peak, precip[stop++] ?? 0);
  const endsInMin = stop < end ? minsTo(times[stop - 1]! * 1000) : null;
  const raining = start === first;
  return {
    state: raining ? "wet" : "starting",
    startsInMin: raining ? null : minsTo(times[start]! * 1000 - SLOT_MS),
    endsInMin,
    peakMm: peak,
    intensity: intensityOf(peak),
    horizonMin,
  };
}

/** "About 25 min" style rounding: exact under 10, then to 5 minutes. */
export const roundMinutes = (m: number) => (m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5);

export type PrecipKind = "rain" | "snow" | "mix";

/** From the air temperature (°C), when known: snow at or below 0, either up to 2. */
export function precipKind(tempC: number | null | undefined): PrecipKind {
  if (tempC == null || !Number.isFinite(tempC)) return "rain";
  return tempC <= 0 ? "snow" : tempC <= 2 ? "mix" : "rain";
}
