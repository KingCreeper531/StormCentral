/**
 * Posting to the Storm Central Facebook Page through Meta's Graph API, with
 * the Page's own access token (FB_PAGE_TOKEN, a Page token that doesn't
 * expire). The Page is the token's own (resolvePage), so FB_PAGE_ID is
 * optional, only checked. Free; Meta only rate-limits it.
 */

const GRAPH = "https://graph.facebook.com/v25.0";

export interface FacebookPage {
  id: string;
  token: string;
}

export class FacebookError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FacebookError";
  }
}

/** The token, and FB_PAGE_ID when set (resolvePage finds the real id from the token). */
export function pageFromEnv(env: Record<string, string | undefined> = process.env): FacebookPage | null {
  const token = env.FB_PAGE_TOKEN?.trim();
  return token ? { id: env.FB_PAGE_ID?.trim() ?? "", token } : null;
}

/**
 * What's wrong with the secrets' shape, without printing them: a Page token
 * starts with "EAA" and is 100-400 characters, a Page id is digits only.
 */
export function secretProblems(id: string | undefined, token: string | undefined): string[] {
  const out: string[] = [];
  const t = token ?? "";
  const i = id ?? "";
  if (/^["']|["']$/.test(t.trim())) out.push("FB_PAGE_TOKEN has quotes around it: paste the token alone.");
  if (/\s/.test(t.trim())) out.push("FB_PAGE_TOKEN has spaces or line breaks inside it: copy it again in one piece.");
  if (/^(bearer|access_token)/i.test(t.trim())) out.push('FB_PAGE_TOKEN starts with "Bearer" or "access_token": paste the token alone.');
  if (/^\d+$/.test(t.trim()) && /^EAA/.test(i.trim())) out.push("FB_PAGE_ID and FB_PAGE_TOKEN look swapped: the id is the number, the token starts with EAA.");
  else if (/^\d+$/.test(t.trim())) out.push("FB_PAGE_TOKEN is only digits: that's an id, not a token (a token starts with EAA).");
  else if (t.trim() && !/^["']?EAA/.test(t.trim())) out.push(`FB_PAGE_TOKEN doesn't start with "EAA" (${t.trim().length} characters): it may be the App Secret or another value, not the Page token.`);
  if (/^["']?EAA/.test(t.trim()) && t.trim().length < 100) out.push(`FB_PAGE_TOKEN is only ${t.trim().length} characters: it was probably cut off when copied.`);
  if (i.trim() && !/^\d+$/.test(i.trim()) && !/^EAA/.test(i.trim())) out.push("FB_PAGE_ID isn't only digits (it's optional: the Page comes from the token).");
  return out;
}

type Fetch = typeof fetch;

async function graph<T>(page: FacebookPage, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}, f: Fetch = fetch): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: page.token });
  const url = method === "POST" ? `${GRAPH}/${path}` : `${GRAPH}/${path}?${body}`;
  const res = await f(url, { method, ...(method === "POST" ? { body } : {}), signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  // The token never goes in a message: Meta's errors don't repeat it, and the URL isn't logged.
  if (!res.ok || json.error) throw new FacebookError(`Facebook ${method} ${path.split("?")[0]} failed (${res.status}): ${json.error?.message ?? "no details"}`, res.status);
  return json;
}

/**
 * The Page the token belongs to (a Page token's "me" is the Page), with a
 * clear error for the wrong kind of token: a user token from "Generate Access
 * Token" or an app token can't post as the Page. `mismatch` is set when
 * FB_PAGE_ID names something else (it once held the App ID).
 */
export async function resolvePage(page: FacebookPage, f?: Fetch): Promise<{ page: FacebookPage; name: string; link?: string; mismatch: boolean }> {
  const me = await graph<{ id: string; name: string; link?: string; metadata?: { type?: string } }>(page, "GET", "me", { fields: "id,name,link", metadata: "1" }, f);
  const type = me.metadata?.type;
  if (type && type !== "page")
    throw new FacebookError(
      `FB_PAGE_TOKEN is a ${type} token ("${me.name}"), not the Page's: in the Graph API Explorer, run me/accounts with it and use the Page's own access_token (shorts/README.md, Facebook).`,
      400,
    );
  return { page: { id: me.id, token: page.token }, name: me.name, link: me.link, mismatch: !!page.id && page.id !== me.id };
}

/** The Page's name and link: checks the token works and is the Page's own. */
export const pageInfo = (page: FacebookPage, f?: Fetch) => graph<{ id: string; name: string; link?: string }>(page, "GET", page.id, { fields: "id,name,link" }, f);

/**
 * A post on the Page's feed; returns its id. `published: false` makes a
 * hidden post (for testing that posting works without anyone seeing it).
 */
export const postToPage = (page: FacebookPage, message: string, { link, published = true }: { link?: string; published?: boolean } = {}, f?: Fetch) =>
  graph<{ id: string }>(page, "POST", `${page.id}/feed`, { message, ...(link ? { link } : {}), ...(published ? {} : { published: "false" }) }, f).then((r) => r.id);

/**
 * A photo post on the Page (the picture uploaded with the post, `message`
 * under it); returns the post's id. `published: false` hides it (testing).
 */
export async function postPhoto(page: FacebookPage, image: Buffer, message: string, { published = true }: { published?: boolean } = {}, f: Fetch = fetch): Promise<string> {
  const form = new FormData();
  form.set("source", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "warning.jpg");
  form.set("message", message);
  if (!published) form.set("published", "false");
  form.set("access_token", page.token);
  const res = await f(`${GRAPH}/${page.id}/photos`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  const json = (await res.json().catch(() => ({}))) as { id?: string; post_id?: string; error?: { message?: string } };
  if (!res.ok || json.error || !json.id) throw new FacebookError(`Facebook POST photos failed (${res.status}): ${json.error?.message ?? "no details"}`, res.status);
  // The feed post (page_postid) when Facebook gives it; else the photo, which is a post too.
  return json.post_id ?? json.id;
}

/**
 * A Reel on the Page from a vertical video (the Shorts: 1080x1920, 3 to 90
 * seconds): Meta's three steps, start (a video id and an upload address),
 * the bytes, then finish with the description and published. Returns the id.
 */
export async function postReel(page: FacebookPage, video: Buffer, description: string, f: Fetch = fetch): Promise<string> {
  const start = await graph<{ video_id?: string; upload_url?: string }>(page, "POST", `${page.id}/video_reels`, { upload_phase: "start" }, f);
  if (!start.video_id || !start.upload_url) throw new FacebookError("Facebook didn't give a Reel upload address", 500);
  const up = await f(start.upload_url, {
    method: "POST",
    headers: { Authorization: `OAuth ${page.token}`, offset: "0", file_size: String(video.length), "Content-Type": "application/octet-stream" },
    body: new Uint8Array(video),
    signal: AbortSignal.timeout(300_000),
  });
  const upJson = (await up.json().catch(() => ({}))) as { success?: boolean; debug_info?: { message?: string } };
  if (!up.ok || upJson.success === false) throw new FacebookError(`Facebook Reel upload failed (${up.status}): ${upJson.debug_info?.message ?? "no details"}`, up.status);
  const done = await graph<{ success?: boolean }>(page, "POST", `${page.id}/video_reels`, { upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description }, f);
  if (done.success === false) throw new FacebookError("Facebook didn't publish the Reel", 500);
  return start.video_id;
}

/** A Short's YouTube title and description as a Reel's: the title without #shorts, the first paragraph, the site and the hashtags. */
export function reelDescription(title: string, description: string): string {
  const paras = description.split(/\n\n+/);
  const tags = paras.find((p) => /^#\w/.test(p.trim()))?.replace(/\s*#shorts\b/gi, "").trim();
  return [title.replace(/\s*#shorts\b/gi, "").trim(), paras[0]?.trim(), "Live radar and alerts, free: https://www.stormcentralwx.com", tags].filter(Boolean).join("\n\n");
}

export const deletePost = (page: FacebookPage, postId: string, f?: Fetch) => graph<{ success?: boolean }>(page, "DELETE", postId, {}, f);
