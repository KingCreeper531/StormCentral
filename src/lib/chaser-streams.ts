/**
 * Live storm chaser streams, like a TV storm-chasing desk: which of a list of
 * storm chasers' YouTube channels are live right now (plus the streams that
 * chasers sharing their position in Storm Central linked), to watch in the
 * radar's Chasers panel. Shared by the server (lib/server/chaser-streams) and
 * the panel.
 */
import type { LiveStream } from "./chasers";

/** A storm chaser's YouTube channel: by channel id where known (free to check), otherwise by @handle. */
export interface ChaserChannel {
  /** Shown until YouTube's own channel name is known. */
  name: string;
  channelId?: string;
  handle?: string;
}

/**
 * Storm chasers and severe weather streamers whose channels were checked by
 * hand. More can be added without a code change with CHASER_CHANNELS (comma-
 * separated @handles or channel ids). Only add channels you've opened
 * yourself: the panel shows whatever the channel streams.
 */
export const CHASER_CHANNELS: ChaserChannel[] = [
  { name: "Ryan Hall, Y'all", channelId: "UCJHAT3Uvv-g3I8H3GhHWV7w" },
  { name: "Reed Timmer", channelId: "UCV6hWxB0-u_IX7e-h4fEBAw" },
  { name: "Pecos Hank", channelId: "UCAQpSHsgUcNt6uCOjpgD8kw" },
  { name: "Live Storm Chasers", channelId: "UCpLuZpjFlPJDBD3Evume1tw" },
  { name: "Storm Chaser Vince Waelti", handle: "@StormChaserVince" },
  { name: "Storm Chaser Brad Arnold", channelId: "UCj6aoh3tZuQoqfHs4ZWpHcA" },
  { name: "Texas Storm Chasers", handle: "@TSCWX" },
];

const CHANNEL_ID = /^UC[\w-]{22}$/;
const HANDLE = /^@[\w.-]{3,30}$/;

/** CHASER_CHANNELS: "@handle, UC…, …" into channels (anything else is skipped). */
export function parseChannelList(value: string | undefined): ChaserChannel[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .flatMap((s): ChaserChannel[] => (CHANNEL_ID.test(s) ? [{ name: s, channelId: s }] : HANDLE.test(s) ? [{ name: s, handle: s }] : []));
}

/** A chaser who is live on YouTube right now. */
export interface LiveChaserStream {
  videoId: string;
  channelId: string;
  /** YouTube's name for the channel. */
  channelName: string;
  /** Lower case with the @, when the channel was named by its handle. */
  handle: string | null;
  title: string;
  thumbnail: string | null;
  viewers: number | null;
  /** ISO time the stream started. */
  startedAt: string | null;
  url: string;
  embed: string;
}

export interface ChaserStreamsResponse {
  live: LiveChaserStream[];
  /** Every channel on the list, live or not, to open on YouTube. */
  channels: { name: string; url: string }[];
  /** False when the server can't check live status (no YouTube API key): only the channel list is shown. */
  liveStatus: boolean;
  updated: string;
}

/** The keys a live stream can be matched by: its video, its channel and its handle. */
export const liveKeys = (s: LiveChaserStream) => [s.videoId, s.channelId, s.handle].filter((k): k is string => !!k);

/** The live stream a chaser's linked stream (lib/chasers parseStream) belongs to, if it's live. */
export function liveFor(stream: LiveStream | null | undefined, live: Map<string, LiveChaserStream>): LiveChaserStream | null {
  if (!stream) return null;
  for (const key of [stream.videoId, stream.channelId, stream.handle]) {
    const hit = key ? live.get(key) : undefined;
    if (hit) return hit;
  }
  return null;
}

/** Live streams by every key they can be matched by. */
export function liveIndex(streams: LiveChaserStream[]): Map<string, LiveChaserStream> {
  const out = new Map<string, LiveChaserStream>();
  for (const s of streams) for (const k of liveKeys(s)) out.set(k, s);
  return out;
}
