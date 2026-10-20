/**
 * Sounding analysis for Professional mode (NSHARP-style): parcel lifting,
 * CAPE/CIN for surface-based, mixed-layer and most-unstable parcels, lifted
 * index, precipitable water, lapse rates, and the kinematics (bulk shear,
 * Bunkers storm motion, storm-relative helicity, critical angle).
 *
 * Pure functions on a profile ordered from the surface up (decreasing
 * pressure). Units: hPa, °C, metres above sea level, m/s.
 */

export interface Level {
  /** Pressure, hPa. */
  p: number;
  /** Height above sea level, m. */
  z: number;
  /** Temperature, °C. */
  t: number;
  /** Dew point, °C. */
  td: number;
  /** Wind toward the east / north, m/s. */
  u: number;
  v: number;
}

export interface Sounding {
  levels: Level[];
  /** Surface height above sea level, m (levels[0].z). */
  sfcZ: number;
}

const RD = 287.04;
const CP = 1005.7;
const G = 9.80665;
const EPS = 0.622;
const LV = 2.501e6;
const K = 273.15;

/** Saturation vapour pressure over water, hPa (Bolton 1980). */
export const satVapPres = (tc: number) => 6.112 * Math.exp((17.67 * tc) / (tc + 243.5));

/** Mixing ratio (kg/kg) of air at `p` hPa with dew point `tdc`. */
export function mixingRatio(p: number, tdc: number): number {
  const e = satVapPres(tdc);
  return (EPS * e) / Math.max(1e-6, p - e);
}

/** Dew point (°C) of air at `p` hPa with mixing ratio `w` (kg/kg). */
export function dewpointFromMixingRatio(p: number, w: number): number {
  const e = (w * p) / (EPS + w);
  const l = Math.log(Math.max(1e-6, e) / 6.112);
  return (243.5 * l) / (17.67 - l);
}

/** Potential temperature, K. */
export const theta = (p: number, tc: number) => (tc + K) * Math.pow(1000 / p, RD / CP);

/** Equivalent potential temperature, K (Bolton 1980, eq. 43). */
export function thetaE(p: number, tc: number, tdc: number): number {
  const w = mixingRatio(p, tdc);
  const tl = lcl(p, tc, tdc).t + K;
  return (tc + K) * Math.pow(1000 / p, 0.2854 * (1 - 0.28 * w)) * Math.exp((3.376 / tl - 0.00254) * w * 1000 * (1 + 0.81 * w));
}

/** Virtual temperature, K. */
const virtualK = (tk: number, w: number) => (tk * (1 + w / EPS)) / (1 + w);

/** Lifting condensation level of a parcel: pressure (hPa) and temperature (°C). Bolton (1980) eq. 15. */
export function lcl(p: number, tc: number, tdc: number): { p: number; t: number } {
  const tk = tc + K;
  const tdk = Math.min(tdc, tc) + K;
  const tl = 1 / (1 / (tdk - 56) + Math.log(tk / tdk) / 800) + 56;
  return { p: p * Math.pow(tl / tk, CP / RD), t: tl - K };
}

/** dT/dp (K/hPa) along a saturated pseudo-adiabat. */
function moistLapse(p: number, tk: number): number {
  const ws = mixingRatio(p, tk - K);
  return ((RD * tk + LV * ws) / (CP + (LV * LV * ws * EPS) / (RD * tk * tk))) / p;
}

/** Temperature (°C) reached following the moist adiabat from (p0, t0) to p (RK4 in ~5 hPa steps). */
export function moistAdiabat(p0: number, t0c: number, p: number): number {
  if (p0 === p) return t0c;
  const n = Math.max(1, Math.ceil(Math.abs(p - p0) / 5));
  const h = (p - p0) / n;
  let tk = t0c + K;
  let pp = p0;
  for (let i = 0; i < n; i++) {
    const k1 = moistLapse(pp, tk);
    const k2 = moistLapse(pp + h / 2, tk + (h / 2) * k1);
    const k3 = moistLapse(pp + h / 2, tk + (h / 2) * k2);
    const k4 = moistLapse(pp + h, tk + h * k3);
    tk += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    pp += h;
  }
  return tk - K;
}

/** Temperature (°C) after dry-adiabatic ascent from (p0, t0) to p. */
export const dryAdiabat = (p0: number, t0c: number, p: number) => (t0c + K) * Math.pow(p / p0, RD / CP) - K;

/** Linear interpolation of `get` in ln(p). Levels ordered by decreasing pressure. */
export function atPressure(levels: readonly Level[], p: number, get: (l: Level) => number): number | null {
  if (!levels.length || p > levels[0]!.p || p < levels.at(-1)!.p) return null;
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i]!, b = levels[i + 1]!;
    if (p <= a.p && p >= b.p) {
      const f = a.p === b.p ? 0 : (Math.log(a.p) - Math.log(p)) / (Math.log(a.p) - Math.log(b.p));
      return get(a) + f * (get(b) - get(a));
    }
  }
  return null;
}

/** Linear interpolation of `get` in height (m above ground). */
export function atHeightAgl(s: Sounding, agl: number, get: (l: Level) => number): number | null {
  const z = s.sfcZ + agl;
  const L = s.levels;
  if (!L.length || z < L[0]!.z || z > L.at(-1)!.z) return null;
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i]!, b = L[i + 1]!;
    if (z >= a.z && z <= b.z) {
      const f = b.z === a.z ? 0 : (z - a.z) / (b.z - a.z);
      return get(a) + f * (get(b) - get(a));
    }
  }
  return null;
}

export interface Parcel {
  /** Where it starts: pressure (hPa), temperature and dew point (°C). */
  p: number;
  t: number;
  td: number;
}

export interface ParcelResult {
  parcel: Parcel;
  cape: number;
  cin: number;
  /** Lifting condensation level, level of free convection and equilibrium level (hPa); null when there is none. */
  lclP: number;
  lfcP: number | null;
  elP: number | null;
  /** The parcel's temperature (°C) at each pressure of `trace`, for drawing. */
  trace: { p: number; t: number }[];
}

/** Parcel temperature (°C) at pressure p. */
export function parcelTemp(parcel: Parcel, p: number): number {
  const l = lcl(parcel.p, parcel.t, parcel.td);
  return p >= l.p ? dryAdiabat(parcel.p, parcel.t, p) : moistAdiabat(l.p, l.t, p);
}

/** CAPE/CIN (J/kg) and the levels, integrating virtual-temperature buoyancy every ~5 hPa. */
export function liftParcel(s: Sounding, parcel: Parcel): ParcelResult {
  const L = s.levels;
  const top = Math.max(L.at(-1)!.p, 100);
  const l = lcl(parcel.p, parcel.t, parcel.td);
  const w0 = mixingRatio(parcel.p, parcel.td);
  const steps: { p: number; b: number; z: number; tp: number }[] = [];
  // Moist-adiabat temperatures are carried step to step (cheaper and smoother than restarting at the LCL).
  let tMoist: number | null = null;
  let pPrev = parcel.p;
  for (let p = parcel.p; p >= top - 1e-6; p -= 5) {
    let tp: number;
    if (p >= l.p) tp = dryAdiabat(parcel.p, parcel.t, p);
    else {
      tMoist = moistAdiabat(tMoist == null ? l.p : pPrev, tMoist == null ? l.t : tMoist, p);
      tp = tMoist;
    }
    pPrev = p;
    const te = atPressure(L, p, (x) => x.t);
    const tde = atPressure(L, p, (x) => x.td);
    const z = atPressure(L, p, (x) => x.z);
    if (te == null || tde == null || z == null) continue;
    const wp = p >= l.p ? w0 : mixingRatio(p, tp);
    const tvp = virtualK(tp + K, wp);
    const tve = virtualK(te + K, mixingRatio(p, tde));
    steps.push({ p, b: (G * (tvp - tve)) / tve, z, tp });
  }
  // LFC: the first level at or above the LCL where the parcel turns warmer than its surroundings.
  // (Warmth below the LCL, e.g. a mixed-layer parcel over a morning inversion, isn't free convection.)
  let lfc = -1;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]!.p > l.p + 1e-6) continue;
    if (steps[i]!.b > 0 && (i === 0 || steps[i - 1]!.b <= 0 || steps[i - 1]!.p > l.p)) {
      lfc = i;
      break;
    }
  }
  // EL: the highest level where it turns cooler again.
  let el = -1;
  if (lfc >= 0) for (let i = steps.length - 1; i > lfc; i--) if (steps[i - 1]!.b > 0 && steps[i]!.b <= 0) { el = i; break; }
  let cape = 0;
  let cin = 0;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1]!, c = steps[i]!;
    const area = ((a.b + c.b) / 2) * (c.z - a.z);
    if (lfc >= 0 && i > lfc && (el < 0 || i <= el)) cape += Math.max(0, area);
    else if (lfc >= 0 && i <= lfc) cin += Math.min(0, area);
  }
  return {
    parcel,
    cape: Math.round(cape),
    cin: Math.round(cin),
    lclP: Math.round(l.p),
    lfcP: lfc >= 0 ? Math.round(steps[lfc]!.p) : null,
    elP: el >= 0 ? Math.round(steps[el]!.p) : null,
    trace: steps.map((x) => ({ p: x.p, t: x.tp })),
  };
}

/** Surface-based parcel. */
export const surfaceParcel = (s: Sounding): Parcel => ({ p: s.levels[0]!.p, t: s.levels[0]!.t, td: s.levels[0]!.td });

/** Mixed-layer parcel: mean potential temperature and mixing ratio of the lowest `depth` hPa. */
export function mixedLayerParcel(s: Sounding, depth = 100): Parcel {
  const p0 = s.levels[0]!.p;
  let th = 0, w = 0, n = 0;
  for (let p = p0; p >= p0 - depth; p -= 5) {
    const t = atPressure(s.levels, p, (l) => l.t);
    const td = atPressure(s.levels, p, (l) => l.td);
    if (t == null || td == null) continue;
    th += theta(p, t);
    w += mixingRatio(p, td);
    n++;
  }
  th /= n;
  w /= n;
  const t = th * Math.pow(p0 / 1000, RD / CP) - K;
  return { p: p0, t, td: Math.min(t, dewpointFromMixingRatio(p0, w)) };
}

/** Most-unstable parcel: the highest θe in the lowest `depth` hPa. */
export function mostUnstableParcel(s: Sounding, depth = 300): Parcel {
  const p0 = s.levels[0]!.p;
  let best: Parcel = surfaceParcel(s);
  let bestTe = thetaE(best.p, best.t, best.td);
  for (let p = p0; p >= p0 - depth; p -= 10) {
    const t = atPressure(s.levels, p, (l) => l.t);
    const td = atPressure(s.levels, p, (l) => l.td);
    if (t == null || td == null) continue;
    const te = thetaE(p, t, td);
    if (te > bestTe) {
      bestTe = te;
      best = { p, t, td };
    }
  }
  return best;
}

/** Precipitable water, mm. */
export function precipitableWater(s: Sounding): number {
  let pw = 0;
  const L = s.levels;
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1]!, b = L[i]!;
    const qa = mixingRatio(a.p, a.td), qb = mixingRatio(b.p, b.td);
    pw += (((qa / (1 + qa) + qb / (1 + qb)) / 2) * (a.p - b.p) * 100) / G;
  }
  return Math.round(pw * 10) / 10;
}

const speed = (u: number, v: number) => Math.hypot(u, v);
export const MS_TO_KT = 1.943844;

/** Wind components (m/s) from speed (m/s) and the direction it blows *from* (degrees). */
export function windComponents(spd: number, fromDeg: number): { u: number; v: number } {
  const r = (fromDeg * Math.PI) / 180;
  return { u: -spd * Math.sin(r), v: -spd * Math.cos(r) };
}

/** Direction the wind blows from (degrees) and its speed (m/s). */
export function windFrom(u: number, v: number): { dir: number; spd: number } {
  const dir = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { dir, spd: speed(u, v) };
}

const windAt = (s: Sounding, agl: number) => {
  const u = atHeightAgl(s, agl, (l) => l.u);
  const v = atHeightAgl(s, agl, (l) => l.v);
  return u == null || v == null ? null : { u, v };
};

/** Mean wind (m/s) over a layer AGL, sampled every 250 m. */
function meanWind(s: Sounding, bottom: number, top: number) {
  let u = 0, v = 0, n = 0;
  for (let z = bottom; z <= top + 1e-6; z += 250) {
    const w = windAt(s, z);
    if (!w) continue;
    u += w.u;
    v += w.v;
    n++;
  }
  return n ? { u: u / n, v: v / n } : null;
}

/** Bulk wind difference (m/s) between the surface and `depth` m AGL. */
export function bulkShear(s: Sounding, depth: number): number | null {
  const a = windAt(s, 0), b = windAt(s, depth);
  return a && b ? speed(b.u - a.u, b.v - a.v) : null;
}

/** Bunkers (2000) right- and left-mover storm motion and the 0–6 km mean wind (m/s). */
export function bunkers(s: Sounding): { rm: { u: number; v: number }; lm: { u: number; v: number }; mean: { u: number; v: number } } | null {
  const mean = meanWind(s, 0, 6000);
  const low = meanWind(s, 0, 500);
  const high = meanWind(s, 5500, 6000);
  if (!mean || !low || !high) return null;
  const sx = high.u - low.u, sy = high.v - low.v;
  const mag = speed(sx, sy) || 1;
  const d = 7.5;
  return {
    rm: { u: mean.u + (d * sy) / mag, v: mean.v - (d * sx) / mag },
    lm: { u: mean.u - (d * sy) / mag, v: mean.v + (d * sx) / mag },
    mean,
  };
}

/** Storm-relative helicity (m²/s²) from the surface to `depth` m AGL for storm motion (cx, cy). */
export function helicity(s: Sounding, depth: number, storm: { u: number; v: number }): number | null {
  let srh = 0;
  let prev = windAt(s, 0);
  if (!prev) return null;
  for (let z = 100; z <= depth + 1e-6; z += 100) {
    const w = windAt(s, z);
    if (!w) return null;
    srh += (w.u - storm.u) * (prev.v - storm.v) - (prev.u - storm.u) * (w.v - storm.v);
    prev = w;
  }
  return Math.round(srh);
}

/** Critical angle (degrees): between the 0–500 m shear vector and the storm-relative inflow at the surface. */
export function criticalAngle(s: Sounding, storm: { u: number; v: number }): number | null {
  const a = windAt(s, 0), b = windAt(s, 500);
  if (!a || !b) return null;
  const sx = b.u - a.u, sy = b.v - a.v;
  const ix = a.u - storm.u, iy = a.v - storm.v;
  const m = speed(sx, sy) * speed(ix, iy);
  if (!m) return null;
  return Math.round((Math.acos(Math.max(-1, Math.min(1, (sx * ix + sy * iy) / m))) * 180) / Math.PI);
}

/** Temperature lapse rate (°C/km) between two heights AGL. */
export function lapseRate(s: Sounding, bottom: number, top: number): number | null {
  const a = atHeightAgl(s, bottom, (l) => l.t), b = atHeightAgl(s, top, (l) => l.t);
  return a == null || b == null ? null : Math.round(((a - b) / ((top - bottom) / 1000)) * 10) / 10;
}

/** Temperature lapse rate (°C/km) between two pressure levels. */
export function lapseRateP(s: Sounding, pBottom: number, pTop: number): number | null {
  const ta = atPressure(s.levels, pBottom, (l) => l.t), tb = atPressure(s.levels, pTop, (l) => l.t);
  const za = atPressure(s.levels, pBottom, (l) => l.z), zb = atPressure(s.levels, pTop, (l) => l.z);
  if (ta == null || tb == null || za == null || zb == null || zb <= za) return null;
  return Math.round(((ta - tb) / ((zb - za) / 1000)) * 10) / 10;
}

export interface SoundingIndices {
  sb: ParcelResult;
  ml: ParcelResult;
  mu: ParcelResult;
  /** Lifted index of the surface-based parcel at 500 hPa (°C). */
  li: number | null;
  pwat: number;
  lapse03: number | null;
  lapse700500: number | null;
  shear01: number | null;
  shear03: number | null;
  shear06: number | null;
  storm: ReturnType<typeof bunkers>;
  srh01: number | null;
  srh03: number | null;
  criticalAngle: number | null;
}

/** Everything the sounding panel shows. */
export function analyze(s: Sounding): SoundingIndices {
  const sb = liftParcel(s, surfaceParcel(s));
  const ml = liftParcel(s, mixedLayerParcel(s));
  const mu = liftParcel(s, mostUnstableParcel(s));
  const t500 = atPressure(s.levels, 500, (l) => l.t);
  const storm = bunkers(s);
  return {
    sb,
    ml,
    mu,
    li: t500 == null ? null : Math.round((t500 - parcelTemp(sb.parcel, 500)) * 10) / 10,
    pwat: precipitableWater(s),
    lapse03: lapseRate(s, 0, 3000),
    lapse700500: lapseRateP(s, 700, 500),
    shear01: bulkShear(s, 1000),
    shear03: bulkShear(s, 3000),
    shear06: bulkShear(s, 6000),
    storm,
    srh01: storm ? helicity(s, 1000, storm.rm) : null,
    srh03: storm ? helicity(s, 3000, storm.rm) : null,
    criticalAngle: storm ? criticalAngle(s, storm.rm) : null,
  };
}
