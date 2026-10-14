/**
 * Uploading to the Storm Central channel with the YouTube Data API: an access
 * token from the stored refresh token (OAuth), then a resumable upload. Node's
 * fetch only, no SDK. Setup: shorts/README.md.
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
}

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
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
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
    signal: AbortSignal.timeout(300_000),
  });
  if (!put.ok) throw await failure(put, "Uploading the video");
  const video = (await put.json()) as { id?: string; status?: { privacyStatus?: string } };
  if (!video.id) throw new YouTubeError("The upload gave no video id", 500);
  return video.id;
}
