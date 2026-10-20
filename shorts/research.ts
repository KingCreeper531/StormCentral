/**
 * Sources for drafting a Radar School lesson (lesson-draft.ts): Wikipedia
 * articles found by searching the topic, plus NOAA/NWS pages (JetStream, the
 * NWS's online weather school, and any pages named for the topic), reduced to
 * plain text. The drafting model may only use what's in here, and every line
 * it writes must come with a quote that really appears in one of them
 * (verifyQuote), which is what makes the draft checkable.
 */

export interface Source {
  title: string;
  url: string;
  /** "wikipedia" or "noaa" (government pages count as the stronger source). */
  kind: "wikipedia" | "noaa";
  text: string;
}

const UA = "StormCentral Radar School drafts (github.com/KingCreeper531/StormCentral)";
/** NOAA JetStream's radar pages, the default reading for radar topics (missing ones are skipped). */
export const JETSTREAM_RADAR = [
  "https://www.weather.gov/jetstream/radar",
  "https://www.weather.gov/jetstream/doppler",
  "https://www.weather.gov/jetstream/refl",
  "https://www.weather.gov/jetstream/vel",
  "https://www.weather.gov/jetstream/dualpol",
  "https://www.weather.gov/jetstream/tstorms",
];

type Fetch = typeof fetch;

/** Plain text from a web page: no scripts, styles, navigation or tags; paragraphs on their own lines. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|nav|header|footer|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&deg;/g, "°")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** The top Wikipedia articles for `query`, as plain text (each cut to `maxChars`). */
export async function wikipedia(query: string, { limit = 3, maxChars = 24_000, fetchImpl = fetch as Fetch } = {}): Promise<Source[]> {
  const api = "https://en.wikipedia.org/w/api.php";
  const search = (await (
    await fetchImpl(`${api}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json`, { headers: { "User-Agent": UA } })
  ).json()) as { query?: { search?: { title: string }[] } };
  const titles = (search.query?.search ?? []).map((s) => s.title);
  if (!titles.length) return [];
  const pages = (await (
    await fetchImpl(`${api}?action=query&prop=extracts|info&inprop=url&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(titles.join("|"))}&format=json`, {
      headers: { "User-Agent": UA },
    })
  ).json()) as { query?: { pages?: Record<string, { title: string; fullurl?: string; extract?: string }> } };
  return Object.values(pages.query?.pages ?? {})
    .filter((p) => p.extract)
    .map((p) => ({ title: `Wikipedia: ${p.title}`, url: p.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`, kind: "wikipedia" as const, text: p.extract!.slice(0, maxChars) }));
}

/** Government pages as plain text; ones that don't load are skipped. */
export async function pages(urls: string[], { maxChars = 24_000, fetchImpl = fetch as Fetch, log = console.log } = {}): Promise<Source[]> {
  const out: Source[] = [];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        log(`  skipped ${url} (${res.status})`);
        continue;
      }
      const html = await res.text();
      const title = htmlText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? url);
      const text = htmlText(html).slice(0, maxChars);
      if (text.length > 400) out.push({ title, url, kind: /\.gov\//.test(url) || /\.gov$/.test(new URL(url).hostname) ? "noaa" : "wikipedia", text });
    } catch (err) {
      log(`  skipped ${url} (${err instanceof Error ? err.message : err})`);
    }
  }
  return out;
}

const STOP = new Set(
  "a an and are as at be been but by can does for from has have how if in into is it its like more most much not of on or so such than that the their them then there these they this to up was were what when where which while who why will with you your about also each other only some very just".split(" "),
);
/** Lower-case content words, for matching a line or a chapter to passages. */
export const words = (s: string) => (s.toLowerCase().match(/[a-z0-9][a-z0-9.\-']*/g) ?? []).map((w) => w.replace(/[.'-]+$/, "")).filter((w) => w.length > 2 && !STOP.has(w));

/** Paragraph-sized passages of every source, each tagged with its source. */
export function passages(sources: Source[], size = 600): { source: Source; text: string }[] {
  const out: { source: Source; text: string }[] = [];
  for (const source of sources) {
    let cur = "";
    for (const para of source.text.split(/\n\s*\n|\n/)) {
      const p = para.trim();
      if (!p) continue;
      if (cur && cur.length + p.length > size) {
        out.push({ source, text: cur });
        cur = "";
      }
      cur = cur ? `${cur} ${p}` : p;
    }
    if (cur) out.push({ source, text: cur });
  }
  return out;
}

/** The passages most about `topic` (by shared words, government pages first on ties), up to `budget` characters. */
export function relevant(sources: Source[], topic: string, budget = 7_000) {
  const want = new Set(words(topic));
  const scored = passages(sources)
    .map((p) => {
      const w = words(p.text);
      const hits = w.filter((x) => want.has(x)).length;
      return { ...p, score: hits / Math.sqrt(w.length + 20) + (p.source.kind === "noaa" ? 0.05 : 0) };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  const out: typeof scored = [];
  let used = 0;
  for (const p of scored) {
    if (used + p.text.length > budget) continue;
    out.push(p);
    used += p.text.length;
  }
  return out;
}

/** For comparing a quote with the sources: case, quotes, dashes and spacing don't matter. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”"']/g, "")
    .replace(/[–—-]/g, " ")
    .replace(/[^a-z0-9.%° ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The source a quote comes from word for word (at least 25 characters of it), or null. */
export function verifyQuote(quote: string, sources: Source[]): Source | null {
  const q = norm(quote).replace(/\.+$/, "");
  if (q.length < 25) return null;
  return sources.find((s) => norm(s.text).includes(q)) ?? null;
}

const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));

export interface Evidence {
  verdict: "supported" | "weak" | "unsupported";
  why: string;
  quotes: { text: string; source: Source }[];
}

/**
 * Whether `line` is backed by `quotes` (which the model says support it):
 * supported when at least one quote is really in a source, every number in
 * the line is in the verified quotes, and most of the line's content words
 * are in them; weak when the quotes are real but cover little of the line.
 */
export function checkEvidence(line: string, quotes: string[], sources: Source[]): Evidence {
  const verified = quotes.map((q) => ({ text: q, source: verifyQuote(q, sources) })).filter((q): q is { text: string; source: Source } => !!q.source);
  if (!verified.length) return { verdict: "unsupported", why: quotes.length ? "its quotes aren't in any source" : "no quote given", quotes: [] };
  const backing = verified.map((q) => q.text).join(" ");
  const missing = numbers(line).filter((n) => !numbers(backing).includes(n));
  if (missing.length) return { verdict: "unsupported", why: `the number ${missing.join(", ")} isn't in its quotes`, quotes: verified };
  const lw = [...new Set(words(line))];
  const bw = new Set(words(backing).map((w) => w.replace(/s$/, "")));
  const covered = lw.filter((w) => bw.has(w.replace(/s$/, ""))).length / Math.max(1, lw.length);
  if (covered < 0.35) return { verdict: "weak", why: `its quotes cover only ${Math.round(covered * 100)}% of its words`, quotes: verified };
  return { verdict: "supported", why: `${Math.round(covered * 100)}% of its words are in its quotes`, quotes: verified };
}
