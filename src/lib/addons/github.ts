import { AddonError, parseAddon, type Addon } from "./manifest";

/** The file an add-on repository keeps at its root (or in the folder linked to). */
export const MANIFEST_FILE = "stormcentral.json";
/** GitHub topics the in-app browser searches. */
export const ADDON_TOPICS = { theme: "stormcentral-theme", plugin: "stormcentral-plugin" } as const;

const MAX_BYTES = 64 * 1024;
const NAME = "[A-Za-z0-9_.-]+";

export interface ManifestSource {
  /** raw.githubusercontent.com / gist URL the JSON is fetched from. */
  raw: string;
  /** The page to show people. */
  homepage: string;
}

/**
 * Turn what someone pastes into the raw manifest URL. Accepts `owner/repo`,
 * repository, folder and file links on github.com, raw links and gists.
 * Anything off GitHub is refused.
 */
export function resolveManifest(input: string): ManifestSource {
  const s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const short = s.match(new RegExp(`^(${NAME})/(${NAME})$`));
  if (short) return repoSource(short[1]!, short[2]!, "HEAD", "");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new AddonError("Paste a GitHub link or owner/repo.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AddonError("Paste a GitHub link or owner/repo.");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const host = url.hostname.toLowerCase();

  if (host === "github.com" || host === "www.github.com") {
    const [owner, repo, kind, ref, ...rest] = parts;
    if (!owner || !repo) throw new AddonError("That GitHub link doesn't point to a repository.");
    if (!kind) return repoSource(owner, repo, "HEAD", "");
    if ((kind === "blob" || kind === "raw") && ref && rest.length) {
      return { raw: rawUrl(owner, repo, ref, rest.join("/")), homepage: `https://github.com/${owner}/${repo}/blob/${ref}/${rest.join("/")}` };
    }
    if (kind === "tree" && ref) return repoSource(owner, repo, ref, rest.join("/"));
    throw new AddonError("Link to the repository, a folder, or the stormcentral.json file.");
  }
  if (host === "raw.githubusercontent.com") {
    const [owner, repo, ...rest] = parts;
    if (!owner || !repo || rest.length < 2) throw new AddonError("That raw link is incomplete.");
    return { raw: `https://raw.githubusercontent.com/${parts.map(encodeURIComponent).join("/")}`, homepage: `https://github.com/${owner}/${repo}` };
  }
  if (host === "gist.github.com" || host === "gist.githubusercontent.com") {
    const [user, id, , ...file] = parts;
    if (!user || !id || !/^[0-9a-f]+$/i.test(id)) throw new AddonError("That gist link is incomplete.");
    const name = host === "gist.githubusercontent.com" && file.length ? file.join("/") : MANIFEST_FILE;
    return { raw: `https://gist.githubusercontent.com/${user}/${id}/raw/${encodeURIComponent(name)}`, homepage: `https://gist.github.com/${user}/${id}` };
  }
  throw new AddonError("Add-ons install from GitHub only: paste a github.com link or owner/repo.");
}

function rawUrl(owner: string, repo: string, ref: string, path: string) {
  return `https://raw.githubusercontent.com/${[owner, repo, ...ref.split("/"), ...path.split("/")].filter(Boolean).map(encodeURIComponent).join("/")}`;
}

function repoSource(owner: string, repo: string, ref: string, folder: string): ManifestSource {
  const path = folder.endsWith(".json") ? folder : [folder, MANIFEST_FILE].filter(Boolean).join("/");
  const page = ref === "HEAD" && !folder ? `https://github.com/${owner}/${repo}` : `https://github.com/${owner}/${repo}/tree/${ref}/${folder}`;
  return { raw: rawUrl(owner, repo, ref, path), homepage: page.replace(/\/$/, "") };
}

/** Fetch, size-check and validate an add-on from a GitHub link. */
export async function fetchAddon(input: string, signal?: AbortSignal): Promise<Addon> {
  const src = resolveManifest(input);
  let res: Response;
  try {
    res = await fetch(src.raw, { signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    throw new AddonError("Couldn't reach GitHub. Check your connection.");
  }
  if (res.status === 404) throw new AddonError(`No ${MANIFEST_FILE} found there. Check the link and that the repository is public.`);
  if (!res.ok) throw new AddonError(`GitHub answered ${res.status}.`);
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new AddonError("That file is too big for an add-on (64 KB max).");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new AddonError(`${MANIFEST_FILE} isn't valid JSON.`);
  }
  return parseAddon(json, { id: src.raw, homepage: src.homepage });
}

export interface ListedRepo {
  fullName: string;
  description: string | null;
  stars: number;
  url: string;
}

/** Public repositories tagged with the add-on topic, most starred first. */
export async function searchAddons(type: keyof typeof ADDON_TOPICS, signal?: AbortSignal): Promise<ListedRepo[]> {
  const res = await fetch(`https://api.github.com/search/repositories?q=topic:${ADDON_TOPICS[type]}&sort=stars&order=desc&per_page=20`, {
    signal,
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
  });
  if (res.status === 403 || res.status === 429) throw new AddonError("GitHub's search limit was hit. Try again in a minute.");
  if (!res.ok) throw new AddonError(`GitHub answered ${res.status}.`);
  const data = (await res.json()) as { items?: { full_name: string; description: string | null; stargazers_count: number; html_url: string }[] };
  return (data.items ?? []).map((r) => ({ fullName: r.full_name, description: r.description, stars: r.stargazers_count, url: r.html_url }));
}
