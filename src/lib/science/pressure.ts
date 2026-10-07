/**
 * Barometric tendency, classified with the UK Met Office / WMO 3-hour terms.
 */
export type TendencyTerm =
  | "steady"
  | "rising slowly"
  | "rising"
  | "rising quickly"
  | "rising very rapidly"
  | "falling slowly"
  | "falling"
  | "falling quickly"
  | "falling very rapidly";

export interface Tendency {
  /** hPa change over the last 3 hours. */
  delta3h: number;
  term: TendencyTerm;
  direction: -1 | 0 | 1;
}

export function classifyTendency(delta3h: number): Tendency {
  const a = Math.abs(delta3h);
  const direction = a < 0.1 ? 0 : delta3h > 0 ? 1 : -1;
  if (direction === 0) return { delta3h, term: "steady", direction };
  const word = direction > 0 ? "rising" : "falling";
  const modifier = a <= 1.5 ? " slowly" : a <= 3.5 ? "" : a <= 6 ? " quickly" : " very rapidly";
  return { delta3h, term: `${word}${modifier}` as TendencyTerm, direction };
}

/**
 * Tendency at index `i` of an hourly series (needs i ≥ 3). Returns null when
 * data is missing.
 */
export function tendencyAt(series: ReadonlyArray<number | null>, i: number): Tendency | null {
  const now = series[i];
  const then = series[i - 3];
  if (now == null || then == null) return null;
  return classifyTendency(now - then);
}
