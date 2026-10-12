/**
 * How times read across the app: the 12/24-hour setting and which time zone
 * to use. Set from the app store (store/app-store.ts) as soon as settings load
 * and whenever they change; read by every time formatter via lib/weather/view.
 */

export type ClockPref = "auto" | "12" | "24";
/**
 * "auto": the zone of the place on screen, which with My location on is the
 * zone you are in (detected from your coordinates, so it is right even before
 * the phone's own clock catches up after crossing a zone line).
 * "device": always the device's own zone.
 */
export type ZonePref = "auto" | "device";

let clock: ClockPref = "auto";
let zone: ZonePref = "auto";
let version = 0;

export function setTimePrefs(next: { clock?: ClockPref; zone?: ZonePref }) {
  const c = next.clock ?? clock;
  const z = next.zone ?? zone;
  if (c === clock && z === zone) return;
  clock = c;
  zone = z;
  version++;
}

/** Changes whenever a preference does (cache keys for formatters). */
export const timePrefsVersion = () => version;

/** The zone to format in: the given one, or the device's when the user chose that. */
export const zoneFor = (tz: string | undefined) => (zone === "device" ? undefined : tz);

/** Adds the 12/24-hour choice to formatter options that show hours. */
export function withClock(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  if (clock === "auto" || !opts.hour || opts.hourCycle || opts.hour12 !== undefined) return opts;
  return { ...opts, hourCycle: clock === "12" ? "h12" : "h23" };
}

export const isValidClock = (v: unknown): v is ClockPref => v === "auto" || v === "12" || v === "24";
export const isValidZone = (v: unknown): v is ZonePref => v === "auto" || v === "device";

/** The device's IANA zone ("America/Chicago"), or null. */
export function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
