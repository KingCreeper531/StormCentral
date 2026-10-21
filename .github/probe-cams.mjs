// Temporary: reads camera sources' terms from a CI runner. Removed after use.
const UA = { "User-Agent": "Mozilla/5.0 (StormCentral terms check; github.com/KingCreeper531/StormCentral)" };
const get = async (url, ms = 45_000) => { try { return await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), redirect: "follow" }); } catch (e) { return { ok: false, status: `ERR ${e.cause?.code ?? e.message}`, headers: new Headers(), text: async () => "" }; } };
const plain = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;|&#34;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ");
const hrefs = (html, base) => [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, "&"), base).href; } catch { return null; } }).filter(Boolean);
async function page(name, url, re, width = 900, max = 3) {
  console.log(`\n--- ${name}\n${url}`);
  const r = await get(url);
  console.log(`status ${r.status} ${r.headers.get("content-type")}`);
  if (!r.ok) return "";
  const html = await r.text();
  const t = plain(html);
  console.log(`text length ${t.length}`);
  let n = 0;
  for (const m of t.matchAll(new RegExp(re.source, "gi"))) { console.log(`> …${t.slice(Math.max(0, m.index - 100), m.index + width)}…`); if (++n >= max) break; }
  if (!n) console.log(`(no match) start: ${t.slice(0, 600)}`);
  return html;
}
// Iowa: the "GIS Data Terms of Use" linked from the camera layer's licence.
const item = await (await get("https://www.arcgis.com/sharing/rest/content/items/c4063f200a7b4da5826e2ac86c677cf5?f=json")).json();
const links = hrefs(item.licenseInfo ?? "", "https://www.arcgis.com/");
console.log(`Iowa licence links: ${links.join(" | ")}`);
for (const l of links.filter((l) => !/creativecommons/.test(l))) await page("Iowa GIS Data Terms of Use", l, /(camera|image|attribut|licen|use of|terms)/, 900, 4);
// WSDOT: whatever disclaimer/terms page its traffic API page links to.
const wsHtml = await page("WSDOT traffic API", "https://wsdot.wa.gov/traffic/api/", /Highway Cameras/, 200, 1);
for (const l of [...new Set(hrefs(wsHtml, "https://wsdot.wa.gov/traffic/api/").filter((l) => /disclaim|terms|policy|polic|copyright/i.test(l)))].slice(0, 4))
  await page("WSDOT linked policy", l, /(camera|image|reuse|copyright|third|commercial|permission|use of)/, 700, 3);
// Oregon: the FAQ answer about private use, with a longer timeout.
await page("Oregon TripCheck FAQ", "https://tripcheck.com/pages/frequently-asked-questions", /available for private use/, 1200, 1);
