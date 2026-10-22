/**
 * Posting to the Storm Central Facebook Page through Meta's Graph API, with
 * the Page's own access token (FB_PAGE_TOKEN, a Page token that doesn't
 * expire) and its id (FB_PAGE_ID). Free; Meta only rate-limits it.
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

export function pageFromEnv(env: Record<string, string | undefined> = process.env): FacebookPage | null {
  const id = env.FB_PAGE_ID?.trim();
  const token = env.FB_PAGE_TOKEN?.trim();
  return id && token ? { id, token } : null;
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

/** The Page's name and link: checks the token works and is the Page's own. */
export const pageInfo = (page: FacebookPage, f?: Fetch) => graph<{ id: string; name: string; link?: string }>(page, "GET", page.id, { fields: "id,name,link" }, f);

/**
 * A post on the Page's feed; returns its id. `published: false` makes a
 * hidden post (for testing that posting works without anyone seeing it).
 */
export const postToPage = (page: FacebookPage, message: string, { link, published = true }: { link?: string; published?: boolean } = {}, f?: Fetch) =>
  graph<{ id: string }>(page, "POST", `${page.id}/feed`, { message, ...(link ? { link } : {}), ...(published ? {} : { published: "false" }) }, f).then((r) => r.id);

export const deletePost = (page: FacebookPage, postId: string, f?: Fetch) => graph<{ success?: boolean }>(page, "DELETE", postId, {}, f);
