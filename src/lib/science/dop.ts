/**
 * Dilution of precision from satellite geometry. Each satellite contributes a
 * row [cos(el)·sin(az), cos(el)·cos(az), sin(el), 1] to the geometry matrix G;
 * Q = (GᵀG)⁻¹ and the DOPs are square roots of sums of its diagonal.
 */
export interface SkyPoint {
  /** Radians. */
  azimuth: number;
  /** Radians. */
  elevation: number;
}

export interface Dop {
  gdop: number;
  pdop: number;
  hdop: number;
  vdop: number;
}

/** Gauss-Jordan inverse of a 4×4 matrix; null if singular. */
export function invert4(m: number[][]): number[][] | null {
  const n = 4;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const p = a[col]![col]!;
    for (let c = 0; c < 2 * n; c++) a[col]![c]! /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return a.map((row) => row.slice(n));
}

export function computeDop(sats: readonly SkyPoint[]): Dop | null {
  if (sats.length < 4) return null;
  const GtG = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (const s of sats) {
    const ce = Math.cos(s.elevation);
    const row = [ce * Math.sin(s.azimuth), ce * Math.cos(s.azimuth), Math.sin(s.elevation), 1];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) GtG[i]![j]! += row[i]! * row[j]!;
  }
  const Q = invert4(GtG);
  if (!Q) return null;
  const q = (i: number) => Q[i]![i]!;
  return {
    gdop: Math.sqrt(q(0) + q(1) + q(2) + q(3)),
    pdop: Math.sqrt(q(0) + q(1) + q(2)),
    hdop: Math.sqrt(q(0) + q(1)),
    vdop: Math.sqrt(q(2)),
  };
}
