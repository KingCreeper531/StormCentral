/**
 * Posting to X as the Storm Central account: POST /2/tweets signed with
 * OAuth 1.0a (user context), which is what X requires for posting on behalf
 * of an account. Node's crypto only, no SDK.
 */
import { createHmac, randomBytes } from "node:crypto";

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The OAuth 1.0a signature for a request. `params` are the query and form
 * parameters (a JSON body is not signed).
 */
export function oauthSignature(method: string, url: string, params: Record<string, string>, consumerSecret: string, tokenSecret: string): string {
  const normalized = Object.entries(params)
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(normalized)].join("&");
  return createHmac("sha1", `${pct(consumerSecret)}&${pct(tokenSecret)}`).update(base).digest("base64");
}

/** The Authorization header for a request (nonce and timestamp can be fixed for tests). */
export function authHeader(
  method: string,
  url: string,
  creds: XCredentials,
  extra: Record<string, string> = {},
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const signature = oauthSignature(method, url, { ...oauth, ...extra }, creds.apiSecret, creds.accessSecret);
  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
      .join(", ")
  );
}

export class XError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "XError";
  }
}

const TWEETS = "https://api.x.com/2/tweets";
const MEDIA = "https://api.x.com/2/media/upload";

/** A signed request to the X API (OAuth 1.0a; JSON and multipart bodies aren't part of the signature). */
async function xRequest<T>(url: string, creds: XCredentials, body?: { json: unknown } | { form: FormData }): Promise<T> {
  const headers: Record<string, string> = { Authorization: authHeader("POST", url, creds) };
  let payload: string | FormData | undefined;
  if (body && "json" in body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body.json);
  } else if (body) payload = body.form;
  const res = await fetch(url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let parsed: { detail?: string; title?: string; errors?: { message?: string }[] } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // Not JSON (an empty or HTML error page): the status says enough.
  }
  if (!res.ok) throw new XError(`X ${res.status}: ${parsed.detail ?? parsed.errors?.[0]?.message ?? parsed.title ?? "request failed"}`, res.status);
  return parsed as T;
}

/** Posts the text, with up to 4 uploaded images; returns the new post's id. */
export async function postToX(text: string, creds: XCredentials, mediaIds: string[] = []): Promise<string> {
  const body = await xRequest<{ data?: { id?: string } }>(TWEETS, creds, {
    json: mediaIds.length ? { text, media: { media_ids: mediaIds } } : { text },
  });
  if (!body.data?.id) throw new XError("X: post failed (no id)", 500);
  return body.data.id;
}

const CHUNK = 1 << 20;

/** Uploads an image (initialize, append in 1 MB chunks, finalize); returns its media id for postToX. */
export async function uploadImage(bytes: Uint8Array, mediaType: string, creds: XCredentials): Promise<string> {
  const init = await xRequest<{ data?: { id?: string } }>(`${MEDIA}/initialize`, creds, {
    json: { media_type: mediaType, total_bytes: bytes.length, media_category: "tweet_image" },
  });
  const id = init.data?.id;
  if (!id) throw new XError("X media: no id", 500);
  for (let at = 0, segment = 0; at < bytes.length; at += CHUNK, segment++) {
    const form = new FormData();
    form.append("segment_index", String(segment));
    form.append("media", new Blob([bytes.slice(at, at + CHUNK)], { type: mediaType }), "media");
    await xRequest(`${MEDIA}/${id}/append`, creds, { form });
  }
  // Images are ready once finalized (only video comes back with processing to wait for).
  await xRequest(`${MEDIA}/${id}/finalize`, creds);
  return id;
}

/** Credentials from the environment (GitHub Actions secrets), or null when any is missing. */
export function credentialsFromEnv(env: Record<string, string | undefined> = process.env): XCredentials | null {
  const c = { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET };
  return c.apiKey && c.apiSecret && c.accessToken && c.accessSecret ? (c as XCredentials) : null;
}
