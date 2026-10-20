/**
 * Uploading to the Storm Central channel with the YouTube Data API: an access
 * token from the stored refresh token (OAuth), a resumable upload with the
 * Spanish title and description as a localization, then the video added to
 * its playlist. Node's fetch only, no SDK. Setup: shorts/README.md.
 */
import { readFileSync, statSync } from "node:fs";

export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface VideoMeta {
  title: string;
  description: string;
  tags: string[];
  /** "public", "unlisted" or "private". */
  privacy: string;
  /** Translated titles and descriptions by language ("es"). */
  localizations?: Record<string, { title: string; description: string }>;
}

const API = "https://www.googleapis.com/youtube/v3";

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

/** Credentials from the environment (GitHub secrets), or null when any is missing. */
export function credentialsFromEnv(env: Record<string, string | undefined> = process.env): YouTubeCredentials | null {
  const c = { clientId: env.YT_CLIENT_ID, clientSecret: env.YT_CLIENT_SECRET, refreshToken: env.YT_REFRESH_TOKEN };
  return c.clientId && c.clientSecret && c.refreshToken ? (c as YouTubeCredentials) : null;
}

async function failure(res: Response, what: string): Promise<YouTubeError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string; error_description?: string };
  const detail = typeof body.error === "string" ? `${body.error}${body.error_description ? `: ${body.error_description}` : ""}` : body.error?.message;
  return new YouTubeError(`${what} failed (${res.status})${detail ? `: ${detail}` : ""}`, res.status);
}

export async function accessToken(c: YouTubeCredentials): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await failure(res, "Getting an access token");
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Uploads the MP4; returns the video id. */
export async function uploadVideo(file: string, meta: VideoMeta, token: string): Promise<string> {
  const size = statSync(file).size;
  const start = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=${meta.localizations ? "snippet,status,localizations" : "snippet,status"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      // Category 28: Science & Technology.
      snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: "28", defaultLanguage: "en", defaultAudioLanguage: "en" },
      status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false, embeddable: true },
      ...(meta.localizations ? { localizations: meta.localizations } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!start.ok) throw await failure(start, "Starting the upload");
  const location = start.headers.get("location");
  if (!location) throw new YouTubeError("Starting the upload gave no upload address", 500);

  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: readFileSync(file),
    // Full-length lessons run to a few hundred megabytes.
    signal: AbortSignal.timeout(1_800_000),
  });
  if (!put.ok) throw await failure(put, "Uploading the video");
  const video = (await put.json()) as { id?: string; status?: { privacyStatus?: string } };
  if (!video.id) throw new YouTubeError("The upload gave no video id", 500);
  return video.id;
}

/**
 * Sets a video's custom thumbnail (a JPEG under 2 MB). YouTube allows custom
 * thumbnails only on verified channels: otherwise this throws a 403 YouTubeError.
 */
export async function setThumbnail(videoId: string, file: string, token: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
    body: readFileSync(file),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await failure(res, "Setting the thumbnail");
}

async function api<T>(token: string, path: string, what: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json; charset=UTF-8" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await failure(res, what);
  return (await res.json()) as T;
}

/** The channel's playlist with this title, created (public) when there is none; returns its id. */
export async function playlistId(title: string, description: string, token: string): Promise<string> {
  let pageToken = "";
  do {
    const page = await api<{ items?: { id: string; snippet?: { title?: string } }[]; nextPageToken?: string }>(
      token,
      `playlists?part=snippet&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`,
      "Listing playlists",
    );
    const found = page.items?.find((p) => p.snippet?.title === title);
    if (found) return found.id;
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  const created = await api<{ id: string }>(token, "playlists?part=snippet,status", "Creating a playlist", {
    method: "POST",
    body: { snippet: { title, description, defaultLanguage: "en" }, status: { privacyStatus: "public" } },
  });
  return created.id;
}

/**
 * Adds the video to the playlist titled `title` (creating it). Needs the
 * youtube scope, not just youtube.upload: without it this throws a 403
 * YouTubeError (insufficient scopes), which callers treat as a warning.
 */
export async function addToPlaylist(videoId: string, title: string, description: string, token: string): Promise<void> {
  const id = await playlistId(title, description, token);
  await api(token, "playlistItems?part=snippet", "Adding to the playlist", {
    method: "POST",
    body: { snippet: { playlistId: id, resourceId: { kind: "youtube#video", videoId } } },
  });
}

/** The id of the channel's live broadcast that's on air now, or null (needs the youtube scope). */
export async function liveVideoId(token: string): Promise<string | null> {
  const res = await fetch(`${API}/liveBroadcasts?part=id&broadcastStatus=active&broadcastType=all&maxResults=5`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await failure(res, "Finding the live broadcast");
  return ((await res.json()) as { items?: { id: string }[] }).items?.[0]?.id ?? null;
}

/** Changes a video's (or live broadcast's) title, keeping its description and category. Costs 51 quota units. */
export async function setVideoTitle(videoId: string, title: string, token: string): Promise<void> {
  const got = await fetch(`${API}/videos?part=snippet&id=${encodeURIComponent(videoId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!got.ok) throw await failure(got, "Reading the video");
  const snippet = ((await got.json()) as { items?: { snippet: { title: string; description?: string; categoryId: string; tags?: string[] } }[] }).items?.[0]?.snippet;
  if (!snippet) throw new YouTubeError(`No video ${videoId}`, 404);
  if (snippet.title === title) return;
  const res = await fetch(`${API}/videos?part=snippet`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: videoId, snippet: { title, description: snippet.description ?? "", categoryId: snippet.categoryId, tags: snippet.tags } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await failure(res, "Changing the title");
}
