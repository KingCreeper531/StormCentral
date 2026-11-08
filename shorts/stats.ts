/**
 * How the channel's videos are doing, by playlist (each Short kind has its
 * own: Storm Report Recaps, Severe Outlooks…): views, likes and comments from
 * the YouTube Data API, plus watch time and how much of each video people
 * watch from the YouTube Analytics API when the refresh token allows it (the
 * yt-analytics.readonly scope; without it the report says so and carries on).
 * Prints a Markdown report, also to the job summary. Read-only.
 * GitHub Actions: .github/workflows/youtube-stats.yml.
 */
import { appendFileSync } from "node:fs";
import { accessToken, credentialsFromEnv, YouTubeError } from "./youtube";

const API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

export interface VideoStats {
  id: string;
  title: string;
  published: string;
  /** Seconds. */
  duration: number;
  views: number;
  likes: number;
  comments: number;
  playlists: string[];
  /** From YouTube Analytics, when allowed: average seconds watched and percent of the video watched. */
  avgSeconds?: number;
  avgPercent?: number;
}

export interface GroupStats {
  name: string;
  videos: number;
  views: number;
  medianViews: number;
  likesPer100: number;
  avgPercent: number | null;
  best: VideoStats | null;
}

/** ISO 8601 duration ("PT1M5S") in seconds. */
export function isoSeconds(d: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Videos grouped by playlist ("Other" for none), best median views first. A video in two playlists counts in both. */
export function groupByPlaylist(videos: VideoStats[]): GroupStats[] {
  const groups = new Map<string, VideoStats[]>();
  for (const v of videos) for (const p of v.playlists.length ? v.playlists : ["Other"]) groups.set(p, [...(groups.get(p) ?? []), v]);
  return [...groups.entries()]
    .map(([name, vs]) => {
      const views = vs.reduce((n, v) => n + v.views, 0);
      const likes = vs.reduce((n, v) => n + v.likes, 0);
      const pct = vs.filter((v) => v.avgPercent != null);
      return {
        name,
        videos: vs.length,
        views,
        medianViews: median(vs.map((v) => v.views)),
        likesPer100: views ? (100 * likes) / views : 0,
        avgPercent: pct.length ? pct.reduce((n, v) => n + v.avgPercent!, 0) / pct.length : null,
        best: vs.reduce<VideoStats | null>((b, v) => (!b || v.views > b.views ? v : b), null),
      };
    })
    .sort((a, b) => b.medianViews - a.medianViews || b.views - a.views);
}

const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const cell = (s: string) => s.replace(/\|/g, "\\|");

export function report(channel: { subscribers: number; views: number; videos: number }, videos: VideoStats[], analyticsNote: string | null): string {
  const groups = groupByPlaylist(videos);
  const lines = [
    "# Storm Central on YouTube",
    "",
    `${fmt(channel.subscribers)} subscribers, ${fmt(channel.views)} views over ${fmt(channel.videos)} videos.`,
    "",
    ...(analyticsNote ? [`> ${analyticsNote}`, ""] : []),
    "## By kind (playlist), best median first",
    "",
    "| Playlist | Videos | Total views | Median views | Likes per 100 views | Avg watched | Best video |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...groups.map(
      (g) =>
        `| ${cell(g.name)} | ${g.videos} | ${fmt(g.views)} | ${fmt(g.medianViews)} | ${fmt(g.likesPer100, 1)} | ${g.avgPercent == null ? "–" : `${fmt(g.avgPercent)}%`} | ${g.best ? `[${cell(g.best.title)}](https://youtu.be/${g.best.id}) (${fmt(g.best.views)})` : ""} |`,
    ),
    "",
    "## Top 15 videos",
    "",
    "| Views | Likes | Avg watched | Published | Title |",
    "|---:|---:|---:|---|---|",
    ...[...videos]
      .sort((a, b) => b.views - a.views)
      .slice(0, 15)
      .map((v) => `| ${fmt(v.views)} | ${fmt(v.likes)} | ${v.avgPercent == null ? "–" : `${fmt(v.avgPercent)}%`} | ${v.published.slice(0, 10)} | [${cell(v.title)}](https://youtu.be/${v.id}) |`),
    "",
    "## Every video (newest first)",
    "",
    "| Published | Views | Likes | Comments | Length | Avg watched | Playlists | Title |",
    "|---|---:|---:|---:|---:|---:|---|---|",
    ...[...videos]
      .sort((a, b) => b.published.localeCompare(a.published))
      .map(
        (v) =>
          `| ${v.published.slice(0, 16).replace("T", " ")} | ${fmt(v.views)} | ${v.likes} | ${v.comments} | ${v.duration}s | ${v.avgPercent == null ? "–" : `${fmt(v.avgPercent)}%`} | ${cell(v.playlists.join(", "))} | [${cell(v.title)}](https://youtu.be/${v.id}) |`,
      ),
  ];
  return lines.join("\n");
}

async function get<T>(token: string, url: string, what: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new YouTubeError(`${what} failed (${res.status})${body.error?.message ? `: ${body.error.message}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

async function pages<T>(token: string, url: string, what: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken = "";
  for (let i = 0; i < 40; i++) {
    const page = await get<{ items?: T[]; nextPageToken?: string }>(token, `${url}${pageToken ? `&pageToken=${pageToken}` : ""}`, what);
    out.push(...(page.items ?? []));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return out;
}

async function main() {
  const creds = credentialsFromEnv();
  if (!creds) throw new Error("YT_CLIENT_ID, YT_CLIENT_SECRET and YT_REFRESH_TOKEN are needed.");
  const token = await accessToken(creds);

  type Channel = { contentDetails?: { relatedPlaylists?: { uploads?: string } }; statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string } };
  const [channel] = await pages<Channel>(token, `${API}/channels?part=contentDetails,statistics&mine=true`, "Reading the channel");
  const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error("The channel has no uploads playlist.");

  const ids = (await pages<{ contentDetails?: { videoId?: string } }>(token, `${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}`, "Listing uploads"))
    .map((i) => i.contentDetails?.videoId)
    .filter((id): id is string => !!id);

  // Which playlist (kind) each video is in.
  const inPlaylists = new Map<string, string[]>();
  const playlists = await pages<{ id: string; snippet?: { title?: string } }>(token, `${API}/playlists?part=snippet&mine=true&maxResults=50`, "Listing playlists");
  for (const p of playlists) {
    const items = await pages<{ contentDetails?: { videoId?: string } }>(token, `${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${p.id}`, "Listing a playlist");
    for (const i of items) {
      const id = i.contentDetails?.videoId;
      if (id) inPlaylists.set(id, [...(inPlaylists.get(id) ?? []), p.snippet?.title ?? p.id]);
    }
  }

  type Video = { id: string; snippet?: { title?: string; publishedAt?: string }; contentDetails?: { duration?: string }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } };
  const videos: VideoStats[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await get<{ items?: Video[] }>(token, `${API}/videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(",")}`, "Reading videos");
    for (const v of batch.items ?? [])
      videos.push({
        id: v.id,
        title: v.snippet?.title ?? v.id,
        published: v.snippet?.publishedAt ?? "",
        duration: isoSeconds(v.contentDetails?.duration),
        views: Number(v.statistics?.viewCount ?? 0),
        likes: Number(v.statistics?.likeCount ?? 0),
        comments: Number(v.statistics?.commentCount ?? 0),
        playlists: inPlaylists.get(v.id) ?? [],
      });
  }

  // Watch time per video: needs the yt-analytics.readonly scope on the refresh token.
  let analyticsNote: string | null = null;
  try {
    const start = videos.reduce((m, v) => (v.published && v.published < m ? v.published : m), new Date().toISOString()).slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const r = await get<{ rows?: [string, number, number][] }>(
      token,
      `${ANALYTICS}?ids=channel==MINE&startDate=${start}&endDate=${end}&metrics=averageViewDuration,averageViewPercentage&dimensions=video&sort=-averageViewDuration&maxResults=200`,
      "Reading YouTube Analytics",
    );
    const byId = new Map((r.rows ?? []).map(([id, secs, pct]) => [id, { secs, pct }]));
    for (const v of videos) {
      const a = byId.get(v.id);
      if (a) Object.assign(v, { avgSeconds: a.secs, avgPercent: a.pct });
    }
  } catch (err) {
    analyticsNote =
      err instanceof YouTubeError && err.status === 403
        ? "Watch time isn't included: the YouTube refresh token doesn't have the yt-analytics.readonly scope (shorts/README.md, YouTube statistics)."
        : `Watch time isn't included: ${err instanceof Error ? err.message : err}`;
  }

  const md = report(
    { subscribers: Number(channel.statistics?.subscriberCount ?? 0), views: Number(channel.statistics?.viewCount ?? 0), videos: Number(channel.statistics?.videoCount ?? videos.length) },
    videos,
    analyticsNote,
  );
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

if (process.env.VITEST !== "true") {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
