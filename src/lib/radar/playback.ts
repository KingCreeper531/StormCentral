/**
 * Pure playback rules for the radar loop (the React hook just drives a clock).
 */

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export const BASE_FRAME_MS = 450;
/** The newest frame is held longer so the eye can register "now". */
export const LAST_FRAME_DWELL = 3.2;

export function frameDelayMs(index: number, total: number, speed: number): number {
  const base = BASE_FRAME_MS / speed;
  return index === total - 1 ? base * LAST_FRAME_DWELL : base;
}

/**
 * Next index to display when playing forward. Unbuffered frames are skipped
 * *only* if they're older than the newest buffered frame — we never jump
 * past the frame we're waiting on at the loop tail, which would make the
 * loop appear to "skip" in time.
 * Returns `current` if nothing ahead is ready (i.e. buffering).
 */
export function nextPlayableIndex(current: number, ready: readonly boolean[]): number {
  const n = ready.length;
  if (n === 0) return current;
  for (let step = 1; step <= n; step++) {
    const i = (current + step) % n;
    if (ready[i]) return i;
  }
  return current;
}

export function stepIndex(current: number, delta: number, total: number): number {
  if (total === 0) return 0;
  return (((current + delta) % total) + total) % total;
}

/** Crossfade must finish well inside one frame or frames visibly double-expose. */
export function crossfadeFor(speed: number, enabled: boolean): number {
  if (!enabled) return 0;
  return Math.round(Math.min(220, (BASE_FRAME_MS / speed) * 0.45));
}
