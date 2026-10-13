import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betterFix, FRESH_MS, getFreshPosition, isUsableFix, PositionError } from "./device-position";

const NOW = 1_800_000_000_000;

function fix(lat: number, ageMs: number, accuracy: number): GeolocationPosition {
  return { timestamp: NOW - ageMs, coords: { latitude: lat, longitude: -76.9, accuracy } } as unknown as GeolocationPosition;
}

/** A fake Geolocation whose watch is driven by the test. */
function fakeGeo() {
  let onFix: PositionCallback | null = null;
  let onErr: PositionErrorCallback | null = null;
  const geo = {
    options: null as PositionOptions | null,
    cleared: [] as number[],
    watchPosition(ok: PositionCallback, err?: PositionErrorCallback | null, opts?: PositionOptions) {
      onFix = ok;
      onErr = err ?? null;
      geo.options = opts ?? null;
      return 7;
    },
    clearWatch(id: number) {
      geo.cleared.push(id);
    },
    getCurrentPosition() {},
    emit: (p: GeolocationPosition) => onFix?.(p),
    fail: (code: number) => onErr?.({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" } as GeolocationPositionError),
  };
  return geo;
}

describe("isUsableFix", () => {
  it("rejects stale or vague fixes", () => {
    expect(isUsableFix(fix(42.6, 10_000, 30), NOW)).toBe(true);
    expect(isUsableFix(fix(42.6, FRESH_MS + 1, 30), NOW)).toBe(false);
    expect(isUsableFix(fix(42.6, 0, 25_000), NOW)).toBe(false);
    expect(isUsableFix(fix(42.6, 0, NaN), NOW)).toBe(false);
  });
  it("treats a timestamp slightly ahead of the clock as fresh", () => {
    expect(isUsableFix(fix(42.6, -5_000, 30), NOW)).toBe(true);
  });
});

describe("betterFix", () => {
  it("prefers usable, then tighter", () => {
    const stale = fix(41.4, 3 * 3_600_000, 15);
    const fresh = fix(42.6, 5_000, 900);
    expect(betterFix(stale, fresh, NOW)).toBe(fresh);
    expect(betterFix(fresh, stale, NOW)).toBe(fresh);
    const tight = fix(42.6, 5_000, 20);
    expect(betterFix(fresh, tight, NOW)).toBe(tight);
  });
});

describe("getFreshPosition", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks for GPS and skips the replayed last-known fix", async () => {
    const geo = fakeGeo();
    const p = getFreshPosition(geo as unknown as Geolocation, { now: () => NOW });
    expect(geo.options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    geo.emit(fix(41.4, 3 * 3_600_000, 15)); // hours old, somewhere else
    const good = fix(42.6, 1_000, 12);
    geo.emit(good);
    await expect(p).resolves.toBe(good);
    expect(geo.cleared).toEqual([7]);
  });

  it("settles for the best fresh fix when time runs out", async () => {
    const geo = fakeGeo();
    const p = getFreshPosition(geo as unknown as Geolocation, { now: () => NOW, timeoutMs: 1_000 });
    const rough = fix(42.6, 2_000, 1_500);
    geo.emit(rough);
    geo.emit(fix(42.6, 2_000, 3_000));
    vi.advanceTimersByTime(1_000);
    await expect(p).resolves.toBe(rough);
  });

  it("never returns a stale fix", async () => {
    const geo = fakeGeo();
    const p = getFreshPosition(geo as unknown as Geolocation, { now: () => NOW, timeoutMs: 1_000 });
    geo.emit(fix(41.4, 3 * 3_600_000, 15));
    geo.fail(3);
    vi.advanceTimersByTime(1_000);
    await expect(p).rejects.toBeInstanceOf(PositionError);
  });

  it("stops at once when permission is denied", async () => {
    const geo = fakeGeo();
    const p = getFreshPosition(geo as unknown as Geolocation, { now: () => NOW });
    geo.fail(1);
    await expect(p).rejects.toMatchObject({ denied: true, message: "Location permission denied" });
  });
});
