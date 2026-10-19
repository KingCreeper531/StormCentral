import "server-only";
import { and, gt, isNotNull } from "drizzle-orm";
import { CHASER_CHANNELS, parseChannelList, type ChaserChannel, type ChaserStreamsResponse, type LiveChaserStream } from "../chaser-streams";
import { CHASER_MAX_AGE_MS, parseStream } from "../chasers";
import { getDb } from "../db/client";
import { chaserPositions } from "../db/schema";
import { cached } from "../feeds/cache";
import { upstreamJson, upstreamText } from "../feeds/upstream";

/**
 * Which storm chasers are live on YouTube. Each channel's public RSS feed
 * (free) gives its newest videos; one YouTube Data API call (1 quota unit per
 * 50 videos) says which of those are live. With the response cached for two
 * minutes that's well under 1,000 of the 10,000 daily units. Handles are
 * turned into channel ids once a week (1 unit each). Needs YOUTUBE_API_KEY;
 * without it only the channel list goes out.
 */
const YT = "https://www.googleapis.com/youtube/v3";
const WEEK = 7 * 86_400_000;
/** The newest videos looked at per channel: a live stream is always among them. */
const PER_CHANNEL = 4;

const apiKey = () => process.env.YOUTUBE_API_KEY?.trim() || "";
const channelUrl = (c: ChaserChannel) => (c.channelId ? `https://www.youtube.com/channel/${c.channelId}` : `https://www.youtube.com/${c.handle}`);

const handles = new Map<string, { id: string | null; at: number }>();

/** A handle's channel id (cached a week, misses too). */
async function channelIdFor(handle: string, key: string): Promise<string | null> {
  const hit = handles.get(handle.toLowerCase());
  if (hit && Date.now() - hit.at < WEEK) return hit.id;
  const res = await upstreamJson<{ items?: { id?: string }[] }>(`${YT}/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${key}`).catch(() => null);
  const id = res?.items?.[0]?.id ?? null;
  handles.set(handle.toLowerCase(), { id, at: Date.now() });
  return id;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** A channel's name and newest video ids, from its public RSS feed. */
export function parseChannelFeed(xml: string): { name: string | null; videoIds: string[] } {
  const name = xml.match(/<author>\s*<name>([^<]*)<\/name>/)?.[1];
  const videoIds = [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((m) => m[1]!).slice(0, PER_CHANNEL);
  return { name: name ? decode(name.trim()) : null, videoIds };
}

interface VideoItem {
  id?: string;
  snippet?: { channelId?: string; channelTitle?: string; title?: string; liveBroadcastContent?: string; thumbnails?: { medium?: { url?: string } } };
  liveStreamingDetails?: { actualStartTime?: string; concurrentViewers?: string };
}

/** The live ones among `ids` (YouTube Data API videos.list, 50 at a time). */
async function liveVideos(ids: string[], key: string, handleOf: Map<string, string>): Promise<LiveChaserStream[]> {
  const out: LiveChaserStream[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await upstreamJson<{ items?: VideoItem[] }>(`${YT}/videos?part=snippet,liveStreamingDetails&id=${batch.join(",")}&key=${key}`);
    for (const v of res.items ?? []) {
      const sn = v.snippet;
      if (!v.id || !sn?.channelId || sn.liveBroadcastContent !== "live") continue;
      const viewers = Number(v.liveStreamingDetails?.concurrentViewers);
      out.push({
        videoId: v.id,
        channelId: sn.channelId,
        channelName: sn.channelTitle ?? "",
        handle: handleOf.get(sn.channelId) ?? null,
        title: sn.title ?? "",
        thumbnail: sn.thumbnails?.medium?.url ?? null,
        viewers: Number.isFinite(viewers) ? viewers : null,
        startedAt: v.liveStreamingDetails?.actualStartTime ?? null,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        embed: `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1`,
      });
    }
  }
  return out;
}

/** The streams linked by chasers sharing their position right now (only the links, never where they are). */
async function sharedStreams(now: number) {
  const db = await getDb();
  const rows = await db
    .select({ stream: chaserPositions.stream })
    .from(chaserPositions)
    .where(and(isNotNull(chaserPositions.stream), gt(chaserPositions.expiresAt, now), gt(chaserPositions.updatedAt, now - CHASER_MAX_AGE_MS)));
  return rows.map((r) => parseStream(r.stream)).filter((s) => !!s);
}

async function load(): Promise<ChaserStreamsResponse> {
  const key = apiKey();
  const list = [...CHASER_CHANNELS, ...parseChannelList(process.env.CHASER_CHANNELS)];
  const updated = new Date().toISOString();
  if (!key) return { live: [], channels: list.map((c) => ({ name: c.name, url: channelUrl(c) })), liveStatus: false, updated };

  const now = Date.now();
  const shared = await sharedStreams(now).catch(() => []);
  const handleOf = new Map<string, string>();
  const channelIds = new Set<string>();
  const directVideos = new Set<string>();
  const named = new Map<ChaserChannel, string | null>();
  for (const c of list) {
    const id = c.channelId ?? (c.handle ? await channelIdFor(c.handle, key) : null);
    named.set(c, id);
    if (id) {
      channelIds.add(id);
      if (c.handle) handleOf.set(id, c.handle.toLowerCase());
    }
  }
  for (const s of shared) {
    if (s.videoId) directVideos.add(s.videoId);
    const id = s.channelId ?? (s.handle ? await channelIdFor(s.handle, key) : null);
    if (id) {
      channelIds.add(id);
      if (s.handle) handleOf.set(id, s.handle);
    }
  }

  // Each channel's newest videos from its RSS feed; a feed that fails just skips that channel.
  const names = new Map<string, string>();
  const feeds = await Promise.all(
    [...channelIds].map(async (id) => {
      const feed = await upstreamText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { timeoutMs: 8_000 }).catch(() => "");
      const parsed = parseChannelFeed(feed);
      if (parsed.name) names.set(id, parsed.name);
      return parsed.videoIds;
    }),
  );
  const ids = [...new Set([...feeds.flat(), ...directVideos])];
  const live = ids.length ? await liveVideos(ids, key, handleOf) : [];
  live.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
  const channels = list.map((c) => {
    const id = named.get(c);
    return { name: (id && names.get(id)) || c.name, url: channelUrl(c) };
  });
  return { live, channels, liveStatus: true, updated };
}

/** The live streams, shared by every request for two minutes. */
export const chaserStreams = () => cached("chaser-streams", 110_000, load);

export const __test = { load };
