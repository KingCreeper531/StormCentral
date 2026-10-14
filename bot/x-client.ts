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

/** Posts the text; returns the new post's id. */
export async function postToX(text: string, creds: XCredentials): Promise<string> {
  const res = await fetch(TWEETS, {
    method: "POST",
    headers: { Authorization: authHeader("POST", TWEETS, creds), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
  if (!res.ok || !body.data?.id) throw new XError(`X ${res.status}: ${body.detail ?? body.title ?? "post failed"}`, res.status);
  return body.data.id;
}

/** Credentials from the environment (GitHub Actions secrets), or null when any is missing. */
export function credentialsFromEnv(env: Record<string, string | undefined> = process.env): XCredentials | null {
  const c = { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET };
  return c.apiKey && c.apiSecret && c.accessToken && c.accessSecret ? (c as XCredentials) : null;
}
