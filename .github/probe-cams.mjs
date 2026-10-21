// Temporary: reads sections of the Iowa DOT terms of use from a CI runner. Removed after use.
const r = await fetch("https://iowadot.gov/policies_and_statements/terms-of-use", { headers: { "User-Agent": "Mozilla/5.0 (StormCentral terms check)" }, signal: AbortSignal.timeout(45_000) });
const main = (await r.text()).match(/<main[\s\S]*?<\/main>/i)?.[0] ?? "";
const t = main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;|&#34;/g, '"').replace(/&#0?39;|&rsquo;/g, "'").replace(/\s+/g, " ");
const between = (a, b) => { const i = t.indexOf(a, t.indexOf("Terms of Use Attention!")); const j = b ? t.indexOf(b, i + a.length) : i + 4000; return i < 0 ? `(not found: ${a})` : t.slice(i, j < 0 ? i + 4000 : j); };
console.log(`status ${r.status}`);
console.log(`\n=== RESTRICTIONS + DESIGN FILES + REDISTRIBUTION\n${between("Restrictions on Use of Content", "Cameras on the Web The Iowa")}`);
console.log(`\n=== GIS\n${between("Use of Geographic Information Systems (GIS) Data Summary", "Trademarks & Service Marks The")}`);
console.log(`\n=== SEEKING PERMISSION\n${between("Seeking Permission to Use Content Other Than Expressly Stated in These Terms of Use", null)}`);
