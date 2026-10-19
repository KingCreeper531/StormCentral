/**
 * Storm chasers on the map: spotters who choose to share their live position
 * (Settings → Account) while they chase. Shared by the route handlers (which
 * never trust the client), the sharing beacon and the map layer.
 */
import { z } from "zod";
import { bearingDeg, haversineKm, type LatLon } from "./geo";

/** How long sharing lasts before it turns itself off, in hours. */
export const SHARE_HOURS = [1, 4, 12] as const;
export type ShareHours = (typeof SHARE_HOURS)[number];
export const DEFAULT_SHARE_HOURS: ShareHours = 4;
/** No position is kept past this, whatever the device asks for. */
export const MAX_SHARE_MS = 12 * 3_600_000;

/** A position not updated for this long leaves the map (the phone died or lost signal). */
export const CHASER_MAX_AGE_MS = 15 * 60_000;
/** After this a marker looks stale. */
export const CHASER_STALE_MS = 5 * 60_000;
/** The server takes one update per person this often; the beacon waits a little longer. */
export const MIN_UPDATE_MS = 15_000;
/** The beacon sends at most this often… */
export const SEND_INTERVAL_MS = 50_000;
/** …unless the chaser has moved at least this far (metres)… */
export const SEND_MOVE_M = 300;
/** …and never sooner than this after the last send. */
export const SEND_MIN_GAP_MS = 20_000;
/** Fixes vaguer than this (metres) aren't worth putting on a map. */
export const MAX_ACCURACY_M = 2_000;

const nullableNumber = (min: number, max: number) => z.number().finite().min(min).max(max).nullable();

/** PUT /api/chasers: my current position and when sharing ends. */
export const positionSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  /** Degrees clockwise from north; null when standing still or unknown. */
  heading: nullableNumber(0, 360),
  speedKmh: nullableNumber(0, 400),
  accuracyM: nullableNumber(0, MAX_ACCURACY_M),
  /** When sharing turns itself off (epoch ms), capped at 12 hours from now by the server. */
  until: z.number().int().positive(),
  /** The chaser's YouTube live stream, as they typed it (parseStream checks it). */
  stream: z.string().trim().max(200).nullish(),
});
export type PositionInput = z.infer<typeof positionSchema>;

/** A chaser's YouTube live stream: where to watch it, and a player address when it can play in Storm Central. */
export interface LiveStream {
  url: string;
  /** Null for a channel known only by its @handle: YouTube can't embed that one's live stream, so it opens on YouTube. */
  embed: string | null;
  /** What it points at, to match against the live streams list (lib/chaser-streams). */
  videoId?: string;
  channelId?: string;
  /** Lower case, with the @. */
  handle?: string;
}

const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const HANDLE = /^@[\w.-]{3,30}$/;

/**
 * A YouTube channel or live video, from what a chaser pasted: a video or
 * /live/ link, youtu.be, a /channel/UC… link, a youtube.com/@handle link or
 * just "@handle". Anything else (other sites included) is null, so only
 * YouTube addresses ever reach the map.
 */
export function parseStream(input: string | null | undefined): LiveStream | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (HANDLE.test(raw)) return { url: `https://www.youtube.com/${raw}/live`, embed: null, handle: raw.toLowerCase() };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const video = (id: string | null | undefined): LiveStream | null =>
    id && VIDEO_ID.test(id) ? { url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`, videoId: id } : null;
  if (host === "youtu.be") return video(parts[0]);
  if (host !== "youtube.com") return null;
  if (parts[0] === "watch") return video(u.searchParams.get("v"));
  if (parts[0] === "live" || parts[0] === "embed") return video(parts[1]);
  if (parts[0] === "channel" && parts[1] && CHANNEL_ID.test(parts[1]))
    return { url: `https://www.youtube.com/channel/${parts[1]}/live`, embed: `https://www.youtube.com/embed/live_stream?channel=${parts[1]}&autoplay=1`, channelId: parts[1] };
  if (parts[0] && HANDLE.test(parts[0])) return { url: `https://www.youtube.com/${parts[0]}/live`, embed: null, handle: parts[0].toLowerCase() };
  return null;
}

export interface ChaserDto {
  username: string;
  displayName: string;
  avatarHue: number;
  avatarUrl: string | null;
  reputation: number;
  developer: boolean;
  trusted: boolean;
  lat: number;
  lon: number;
  heading: number | null;
  speedKmh: number | null;
  /** Seconds since the position was sent, as of the response. */
  ageSec: number;
  mine: boolean;
  /** Their YouTube live stream, when they linked one. */
  stream: LiveStream | null;
}

export interface ChasersResponse {
  chasers: ChaserDto[];
}

export interface SentFix extends LatLon {
  at: number;
}

/**
 * Whether the beacon should send a new fix: the first one at once, then every
 * SEND_INTERVAL_MS, or sooner once the chaser has moved SEND_MOVE_M, but never
 * within SEND_MIN_GAP_MS of the last send (the server's own limit is shorter).
 */
export function shouldSend(last: SentFix | null, fix: LatLon, now: number): boolean {
  if (!last) return true;
  const elapsed = now - last.at;
  if (elapsed < SEND_MIN_GAP_MS) return false;
  return elapsed >= SEND_INTERVAL_MS || haversineKm(last, fix) * 1000 >= SEND_MOVE_M;
}

/**
 * Heading and speed for a fix. Phones give both while driving; when they
 * don't, both come from the last fix sent, once the chaser has moved enough
 * for the direction to mean something.
 */
export function motionOf(coords: { heading: number | null; speed: number | null }, fix: LatLon, last: SentFix | null, now: number): { heading: number | null; speedKmh: number | null } {
  const speedKmh = coords.speed != null && Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed * 3.6 : null;
  // Under ~3 km/h a phone's heading is noise.
  const moving = speedKmh == null || speedKmh >= 3;
  let heading = moving && coords.heading != null && Number.isFinite(coords.heading) ? ((coords.heading % 360) + 360) % 360 : null;
  let speed = speedKmh;
  if (last && (heading == null || speed == null)) {
    const km = haversineKm(last, fix);
    const hours = (now - last.at) / 3_600_000;
    if (km * 1000 >= 100 && hours > 0) {
      heading ??= bearingDeg(last, fix);
      speed ??= km / hours;
    }
  }
  return { heading: heading == null ? null : Math.round(heading) % 360, speedKmh: speed == null ? null : Math.min(400, Math.round(speed)) };
}

/** Positions are stored and shown to about 10 m: plenty for a map, no more. */
export const roundCoord = (v: number) => Math.round(v * 1e4) / 1e4;
