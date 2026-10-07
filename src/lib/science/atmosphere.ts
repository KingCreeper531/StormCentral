/** Thermodynamic helpers. Temperatures in °C, heights in metres. */

/** Magnus-formula dew point (Alduchov & Eskridge 1996 coefficients). */
export function dewPoint(tempC: number, rhPct: number) {
  const a = 17.625;
  const b = 243.04;
  const rh = Math.max(1, Math.min(100, rhPct));
  const gamma = Math.log(rh / 100) + (a * tempC) / (b + tempC);
  return (b * gamma) / (a - gamma);
}

/**
 * Lifted condensation level above ground (Espy's approximation):
 * ≈ 125 m per °C of dew-point depression. Good to ~±10% for convective bases.
 */
export function lclHeightM(tempC: number, dewPointC: number) {
  return Math.max(0, 125 * (tempC - dewPointC));
}

export interface CeilingEstimate {
  /** Estimated base of the lowest broken/overcast layer, metres AGL, or null if none. */
  baseM: number | null;
  layer: "low" | "mid" | "high" | "none";
  coverPct: number;
}

/**
 * Estimates the cloud ceiling (lowest layer ≥ 50 % cover, i.e. BKN/OVC)
 * from model cloud-cover-by-level plus the LCL. Models don't publish ceiling
 * directly, so this is labelled "estimated" in the UI.
 */
export function estimateCeiling(input: {
  tempC: number;
  dewPointC: number;
  lowPct: number;
  midPct: number;
  highPct: number;
}): CeilingEstimate {
  const lcl = lclHeightM(input.tempC, input.dewPointC);
  if (input.lowPct >= 50) {
    // Low cloud lives below ~2 km; clamp the LCL into that band.
    return { baseM: Math.min(Math.max(lcl, 60), 2000), layer: "low", coverPct: input.lowPct };
  }
  if (input.midPct >= 50) return { baseM: Math.max(2000, Math.min(lcl, 6000)), layer: "mid", coverPct: input.midPct };
  if (input.highPct >= 50) return { baseM: 6000, layer: "high", coverPct: input.highPct };
  return { baseM: null, layer: "none", coverPct: Math.max(input.lowPct, input.midPct, input.highPct) };
}

/** Density altitude (m) — affects rotor/prop efficiency and battery draw. */
export function densityAltitudeM(stationPressureHpa: number, tempC: number) {
  const pressureAltFt = (1 - (stationPressureHpa / 1013.25) ** 0.190284) * 145366.45;
  const isaTempC = 15 - (1.98 * pressureAltFt) / 1000;
  return (pressureAltFt + 118.8 * (tempC - isaTempC)) / 3.28084;
}

/**
 * Estimated river water temperature from trailing mean air temperature
 * (Stefan & Preud'homme 1993 linear regression), used when no gauge reports it.
 */
export function estimateWaterTempC(meanAirTempC: number) {
  return Math.max(0, 5 + 0.75 * meanAirTempC);
}
