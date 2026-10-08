/**
 * Wind vector math. Directions are meteorological ("from"), degrees.
 */

export interface WindSample {
  heightM: number;
  speedMs: number;
  dirDeg: number;
}

const RAD = Math.PI / 180;

export function toUV(speedMs: number, dirDeg: number) {
  return { u: -speedMs * Math.sin(dirDeg * RAD), v: -speedMs * Math.cos(dirDeg * RAD) };
}

export function fromUV(u: number, v: number) {
  const speed = Math.hypot(u, v);
  const dir = speed === 0 ? 0 : (Math.atan2(-u, -v) / RAD + 360) % 360;
  return { speedMs: speed, dirDeg: dir };
}

/** Signed smallest angle a→b in degrees (+ = clockwise / veering). */
export function angleDiff(a: number, b: number) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

export type ShearClass = "light" | "moderate" | "strong";

export interface ShearResult {
  /** Magnitude of the vector difference, m/s. */
  deltaMs: number;
  /** Bulk shear normalised per 100 m of depth. */
  per100m: number;
  /** Direction change with height; positive = veering (warm advection). */
  veerDeg: number;
  classification: ShearClass;
}

/**
 * Bulk vector shear between two levels. Thresholds are tuned for small UAS
 * (sub-25 kg multirotors) rather than manned aviation LLWS criteria.
 */
export function bulkShear(lower: WindSample, upper: WindSample): ShearResult {
  const a = toUV(lower.speedMs, lower.dirDeg);
  const b = toUV(upper.speedMs, upper.dirDeg);
  const deltaMs = Math.hypot(b.u - a.u, b.v - a.v);
  const depth = Math.max(1, upper.heightM - lower.heightM);
  const per100m = (deltaMs / depth) * 100;
  return {
    deltaMs,
    per100m,
    veerDeg: angleDiff(lower.dirDeg, upper.dirDeg),
    classification: per100m >= 8 ? "strong" : per100m >= 4 ? "moderate" : "light",
  };
}

/**
 * Interpolate wind at an arbitrary height from a sparse profile, using
 * log-height interpolation of u/v components (matches the near-logarithmic
 * surface-layer wind profile far better than linear).
 */
export function windAtHeight(profile: readonly WindSample[], heightM: number): WindSample | null {
  const p = [...profile].filter((s) => Number.isFinite(s.speedMs)).sort((a, b) => a.heightM - b.heightM);
  if (!p.length) return null;
  const first = p[0]!;
  const last = p[p.length - 1]!;
  if (heightM <= first.heightM) {
    // Power-law (α = 1/7) extrapolation below the lowest level.
    const factor = (Math.max(heightM, 1) / first.heightM) ** (1 / 7);
    return { heightM, speedMs: first.speedMs * factor, dirDeg: first.dirDeg };
  }
  if (heightM >= last.heightM) return { ...last, heightM };
  for (let i = 0; i < p.length - 1; i++) {
    const lo = p[i]!;
    const hi = p[i + 1]!;
    if (heightM >= lo.heightM && heightM <= hi.heightM) {
      const t = Math.log(heightM / lo.heightM) / Math.log(hi.heightM / lo.heightM);
      const a = toUV(lo.speedMs, lo.dirDeg);
      const b = toUV(hi.speedMs, hi.dirDeg);
      const w = fromUV(a.u + (b.u - a.u) * t, a.v + (b.v - a.v) * t);
      return { heightM, ...w };
    }
  }
  return null;
}

/** Gust factor — ratio of peak gust to mean wind; > 1.6 signals turbulent flow. */
export function gustFactor(meanMs: number, gustMs: number) {
  return meanMs > 0.5 ? gustMs / meanMs : 1;
}
