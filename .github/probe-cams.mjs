// Temporary: reads the Iowa DOT terms of use from a CI runner. Removed after use.
const r = await fetch("https://iowadot.gov/policies_and_statements/terms-of-use", { headers: { "User-Agent": "Mozilla/5.0 (StormCentral terms check)" }, signal: AbortSignal.timeout(45_000) });
const html = await r.text();
// Only the page's main content, not the site menus.
const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
const t = main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;|&#34;/g, '"').replace(/&#0?39;|&rsquo;/g, "'").replace(/\s+/g, " ");
console.log(`status ${r.status}, main text ${t.length} chars, ids: ${[...main.matchAll(/id="([^"]+)"/g)].map((m) => m[1]).slice(0, 30).join(",")}`);
const gis = t.search(/GIS/);
console.log(`\n=== from first "GIS" (${gis}):\n${t.slice(Math.max(0, gis - 200), gis + 3500)}`);
for (const m of t.matchAll(/(camera|images?|photograph|video)/gi)) console.log(`\n> camera mention: …${t.slice(Math.max(0, m.index - 300), m.index + 500)}…`);
