/**
 * Go / no-go and activity indices. Each factor reports its own status so the
 * UI can explain *why* a score is low — a number alone isn't actionable.
 */
import type { SkyPhase } from "../astro/sun";
import type { Tendency } from "./pressure";

export type FactorStatus = "go" | "caution" | "no-go";

export interface Factor {
  key: string;
  label: string;
  status: FactorStatus;
  detail: string;
}

export interface ScoreResult {
  score: number;
  status: FactorStatus;
  factors: Factor[];
}

const PENALTY: Record<FactorStatus, number> = { go: 0, caution: 14, "no-go": 45 };

function summarize(factors: Factor[]): ScoreResult {
  const score = Math.max(0, 100 - factors.reduce((s, f) => s + PENALTY[f.status], 0));
  const status: FactorStatus = factors.some((f) => f.status === "no-go")
    ? "no-go"
    : factors.some((f) => f.status === "caution")
      ? "caution"
      : "go";
  return { score, status, factors };
}

// ─── UAV ────────────────────────────────────────────────────────────────────

export interface DroneProfile {
  id: string;
  name: string;
  /** Manufacturer max wind resistance, m/s. */
  maxWindMs: number;
  minTempC: number;
  maxTempC: number;
  waterResistant: boolean;
}

export const DRONE_PROFILES: readonly DroneProfile[] = [
  { id: "sub250", name: "Sub-250 g (Mini class)", maxWindMs: 10.7, minTempC: -10, maxTempC: 40, waterResistant: false },
  { id: "prosumer", name: "Prosumer (Air / Mavic class)", maxWindMs: 12, minTempC: -10, maxTempC: 40, waterResistant: false },
  { id: "enterprise", name: "Enterprise (IP55, Matrice class)", maxWindMs: 15, minTempC: -20, maxTempC: 50, waterResistant: true },
  { id: "fpv", name: "FPV / racing quad", maxWindMs: 14, minTempC: -5, maxTempC: 40, waterResistant: false },
];

export interface DroneConditions {
  windAtAltitudeMs: number;
  gustMs: number;
  precipProbPct: number;
  precipMm: number;
  visibilityM: number | null;
  ceilingM: number | null;
  flightAltitudeM: number;
  tempC: number;
  kp: number | null;
  skyPhase: SkyPhase;
  satellitesVisible?: number | null;
}

export function droneFlyability(c: DroneConditions, p: DroneProfile): ScoreResult {
  const f: Factor[] = [];
  const wRatio = c.windAtAltitudeMs / p.maxWindMs;
  f.push({
    key: "wind",
    label: "Wind at altitude",
    status: wRatio >= 1 ? "no-go" : wRatio >= 0.7 ? "caution" : "go",
    detail: `${Math.round(wRatio * 100)}% of airframe limit`,
  });
  const gRatio = c.gustMs / p.maxWindMs;
  f.push({
    key: "gust",
    label: "Gusts",
    status: gRatio >= 1.1 ? "no-go" : gRatio >= 0.8 ? "caution" : "go",
    detail: `${Math.round(gRatio * 100)}% of airframe limit`,
  });
  const wet = c.precipMm >= 0.3 || c.precipProbPct >= 60;
  f.push({
    key: "precip",
    label: "Precipitation",
    status: wet ? (p.waterResistant ? "caution" : "no-go") : c.precipProbPct >= 30 ? "caution" : "go",
    detail: `${Math.round(c.precipProbPct)}% chance`,
  });
  if (c.visibilityM != null) {
    f.push({
      key: "visibility",
      label: "Visibility",
      // 14 CFR 107.51(c): 3 statute miles from the control station.
      status: c.visibilityM < 4828 ? "no-go" : c.visibilityM < 8000 ? "caution" : "go",
      detail: c.visibilityM < 4828 ? "Below 3 SM (Part 107 minimum)" : "Meets VLOS minimums",
    });
  }
  if (c.ceilingM != null) {
    const clearance = c.ceilingM - c.flightAltitudeM;
    f.push({
      key: "ceiling",
      label: "Cloud clearance",
      // 14 CFR 107.51(d): remain 500 ft (152 m) below clouds.
      status: clearance < 152 ? "no-go" : clearance < 300 ? "caution" : "go",
      detail: clearance < 152 ? "Under 500 ft below cloud base" : `${Math.round(clearance)} m below base`,
    });
  }
  f.push({
    key: "temp",
    label: "Battery temperature",
    status:
      c.tempC < p.minTempC || c.tempC > p.maxTempC
        ? "no-go"
        : c.tempC < 5 || c.tempC > p.maxTempC - 5
          ? "caution"
          : "go",
    detail: c.tempC < 5 ? "Pre-warm batteries; expect reduced capacity" : "Within operating range",
  });
  if (c.kp != null) {
    f.push({
      key: "kp",
      label: "Geomagnetic (Kp)",
      status: c.kp >= 7 ? "no-go" : c.kp >= 5 ? "caution" : "go",
      detail: c.kp >= 5 ? `G${Math.min(5, Math.floor(c.kp) - 4)} storm — GNSS & compass degraded` : "Quiet to unsettled",
    });
  }
  const night = c.skyPhase === "night" || c.skyPhase === "astronomical" || c.skyPhase === "nautical";
  f.push({
    key: "light",
    label: "Daylight",
    status: night || c.skyPhase === "civil" ? "caution" : "go",
    detail: night
      ? "Night ops: anti-collision lighting required"
      : c.skyPhase === "civil"
        ? "Civil twilight — lighting recommended"
        : "Daytime operations",
  });
  if (c.satellitesVisible != null) {
    f.push({
      key: "gnss",
      label: "GNSS satellites",
      status: c.satellitesVisible < 6 ? "no-go" : c.satellitesVisible < 10 ? "caution" : "go",
      detail: `${c.satellitesVisible} above 10° mask`,
    });
  }
  return summarize(f);
}

// ─── Angler ─────────────────────────────────────────────────────────────────

export interface AnglerConditions {
  tendency: Tendency | null;
  inMajorPeriod: boolean;
  inMinorPeriod: boolean;
  solunarDayRating: 1 | 2 | 3 | 4;
  /** Hours from the nearest sunrise or sunset. */
  hoursFromSunEvent: number;
  cloudPct: number;
  windMs: number;
  waterTempC: number | null;
  weatherCode: number;
  /** Fractional 24 h discharge change, e.g. 0.25 = +25 %. */
  flowChange24h: number | null;
}

export interface BiteIndex {
  score: number;
  label: "Poor" | "Fair" | "Good" | "Excellent";
  reasons: { text: string; delta: number }[];
  safety: string | null;
}

export function biteIndex(c: AnglerConditions): BiteIndex {
  const reasons: { text: string; delta: number }[] = [];
  const add = (delta: number, text: string) => reasons.push({ delta, text });

  if (c.tendency) {
    const t = c.tendency.term;
    if (t === "falling slowly" || t === "falling") add(18, "Falling barometer ahead of a front");
    else if (t === "steady") add(10, "Stable pressure");
    else if (t === "rising slowly") add(4, "Pressure rising slowly");
    else if (t.startsWith("rising")) add(-12, "Sharp post-frontal pressure rise");
    else add(4, "Rapid pressure fall — feeding burst likely before the storm");
  }
  if (c.inMajorPeriod) add(24, "Solunar major period");
  else if (c.inMinorPeriod) add(14, "Solunar minor period");
  add((c.solunarDayRating - 1) * 3, `Moon phase rating ${c.solunarDayRating}/4`);
  if (c.hoursFromSunEvent <= 1.5) add(14, "Low-light feeding window (dawn/dusk)");
  else if (c.cloudPct >= 70) add(5, "Overcast keeps fish shallow");
  if (c.windMs >= 2 && c.windMs <= 6) add(8, "Light chop breaks up the surface");
  else if (c.windMs > 10) add(-14, "Strong wind — difficult presentation");
  if (c.waterTempC != null) {
    if (c.waterTempC >= 10 && c.waterTempC <= 24) add(8, "Active water temperature");
    else if (c.waterTempC < 4 || c.waterTempC > 29) add(-10, "Lethargic water temperature");
  }
  if (c.flowChange24h != null) {
    if (c.flowChange24h > 0.3) add(-10, "Flow rising fast — turbid water");
    else if (Math.abs(c.flowChange24h) < 0.1) add(5, "Stable river flow");
  }
  let safety: string | null = null;
  if (c.weatherCode >= 95) {
    add(-30, "Thunderstorms");
    safety = "Lightning risk — get off the water when thunder is audible.";
  } else if (c.weatherCode >= 51 && c.weatherCode <= 63) add(3, "Light rain washes in food");

  const score = Math.max(0, Math.min(100, Math.round(30 + reasons.reduce((s, r) => s + r.delta, 0))));
  const label = score >= 70 ? "Excellent" : score >= 50 ? "Good" : score >= 30 ? "Fair" : "Poor";
  return { score, label, reasons: reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)), safety };
}
