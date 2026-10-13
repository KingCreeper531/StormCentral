/**
 * Getting a position you can trust from the browser or the Android app.
 *
 * Android gives web views the phone's last known fix first, and that fix can
 * be hours old and far away (where location was last used), while a
 * low-accuracy request only uses cell towers and Wi-Fi, which barely update
 * in the country or on a lake. So: ask for GPS, skip fixes that are stale or
 * vague, and wait a little for a current one.
 */

/** A fix older than this is where the phone was, not where it is. */
export const FRESH_MS = 2 * 60_000;
/** Coarser than this is an IP- or tower-level guess, not a position. */
export const VAGUE_M = 10_000;

export interface FixQuality {
  /** How old the fix is, in ms (never negative). */
  ageMs: number;
  /** Reported accuracy radius in metres (Infinity when missing). */
  accuracyM: number;
}

export function fixQuality(pos: GeolocationPosition, now: number): FixQuality {
  const acc = pos.coords.accuracy;
  return { ageMs: Math.max(0, now - pos.timestamp), accuracyM: Number.isFinite(acc) && acc > 0 ? acc : Infinity };
}

/** Whether a fix describes where the device is now, closely enough to name the town. */
export function isUsableFix(pos: GeolocationPosition, now: number, maxAgeMs = FRESH_MS, maxAccuracyM = VAGUE_M): boolean {
  const q = fixQuality(pos, now);
  return q.ageMs <= maxAgeMs && q.accuracyM <= maxAccuracyM;
}

/** Of two fixes, the one to keep: usable beats unusable, then newer and tighter. */
export function betterFix(a: GeolocationPosition | null, b: GeolocationPosition, now: number): GeolocationPosition {
  if (!a) return b;
  const ua = isUsableFix(a, now);
  const ub = isUsableFix(b, now);
  if (ua !== ub) return ub ? b : a;
  const qa = fixQuality(a, now);
  const qb = fixQuality(b, now);
  if (!ub && qa.ageMs !== qb.ageMs) return qb.ageMs < qa.ageMs ? b : a;
  return qb.accuracyM <= qa.accuracyM ? b : a;
}

export interface FreshPositionOptions {
  /** Give up waiting for a good fix after this long (default 20 s). */
  timeoutMs?: number;
  /** Stop early once a fresh fix is at least this tight (default 100 m). */
  goodAccuracyM?: number;
  now?: () => number;
}

export class PositionError extends Error {
  constructor(
    message: string,
    readonly denied = false,
  ) {
    super(message);
    this.name = "PositionError";
  }
}

/**
 * Watches the GPS until a fresh, precise fix arrives, then resolves with it.
 * If the time runs out, settles for the best fresh fix seen; stale or vague
 * fixes are never returned, so a cached location from elsewhere can't win.
 */
export function getFreshPosition(geo: Geolocation, opts: FreshPositionOptions = {}): Promise<GeolocationPosition> {
  const { timeoutMs = 20_000, goodAccuracyM = 100, now = Date.now } = opts;
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let done = false;
    let watchId: number | null = null;

    const finish = (pos: GeolocationPosition | null, err?: PositionError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (watchId != null) geo.clearWatch(watchId);
      if (pos) resolve(pos);
      else reject(err ?? new PositionError("Couldn't get a current location fix. Try again with a clear view of the sky."));
    };
    const settle = () => finish(best && isUsableFix(best, now()) ? best : null);
    const timer = setTimeout(settle, timeoutMs);

    watchId = geo.watchPosition(
      (pos) => {
        best = betterFix(best, pos, now());
        if (isUsableFix(pos, now()) && fixQuality(pos, now()).accuracyM <= goodAccuracyM) finish(pos);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) finish(null, new PositionError("Location permission denied", true));
        // Timeouts and "unavailable" can be followed by a fix while the GPS warms up; the overall timer decides.
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
    // A watch that reported synchronously and finished before the id existed.
    if (done && watchId != null) geo.clearWatch(watchId);
  });
}
