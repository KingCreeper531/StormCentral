// Temporary: checks camera sources' terms from a CI runner. Removed after use.
const UA = { "User-Agent": "StormCentral-probe (github.com/KingCreeper531/StormCentral)" };
const get = async (url) => { try { return await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000), redirect: "follow" }); } catch (e) { return { ok: false, status: `ERR ${e.cause?.code ?? e.message}`, text: async () => "", json: async () => null }; } };
const plain = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;|&#34;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ");
async function around(name, url, re, width = 700, max = 4) {
  console.log(`\n--- ${name}\n${url}`);
  const r = await get(url);
  console.log(`status ${r.status}`);
  if (!r.ok) return;
  const t = plain(await r.text());
  console.log(`text length ${t.length}`);
  let n = 0;
  for (const m of t.matchAll(new RegExp(re.source, "gi"))) {
    console.log(`> …${t.slice(Math.max(0, m.index - 80), m.index + width)}…`);
    if (++n >= max) break;
  }
  if (!n) console.log(`(no match for ${re}) start: ${t.slice(0, 400)}`);
}
// Iowa: the camera layer's ArcGIS item (licence) and the state open data catalogue.
const svc = await (await get("https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer?f=json")).json?.().catch(() => null);
console.log(`Iowa service: serviceItemId=${svc?.serviceItemId} copyrightText=${JSON.stringify(svc?.copyrightText)}`);
if (svc?.serviceItemId) {
  const item = await (await get(`https://www.arcgis.com/sharing/rest/content/items/${svc.serviceItemId}?f=json`)).json?.().catch(() => null);
  console.log(`Iowa item: title=${item?.title} owner=${item?.owner} access=${item?.access}`);
  console.log(`  licenseInfo: ${plain(item?.licenseInfo ?? "").slice(0, 900)}`);
  console.log(`  accessInformation: ${plain(item?.accessInformation ?? "").slice(0, 300)}`);
}
const cat = await (await get("https://data.iowa.gov/api/catalog/v1?q=traffic%20cameras&limit=5")).json?.().catch(() => null);
for (const r of cat?.results ?? []) console.log(`data.iowa.gov: ${r.resource?.name} id=${r.resource?.id} license=${r.metadata?.license} attribution=${r.resource?.attribution}`);
const hub = await (await get("https://hub.arcgis.com/api/v3/datasets?q=iowa%20traffic%20cameras&page%5Bsize%5D=5")).json?.().catch(() => null);
for (const d of hub?.data ?? []) console.log(`hub: ${d.attributes?.name} | ${d.attributes?.source} | license: ${plain(d.attributes?.licenseInfo ?? "").slice(0, 300)}`);

await around("Oregon TripCheck FAQ", "https://tripcheck.com/pages/frequently-asked-questions", /available for private use/, 900, 1);
await around("Nebraska DOT policies", "https://dot.nebraska.gov/policies-and-disclaimers/", /camera/, 500, 4);
await around("Ohio OHGO terms", "https://publicapi.ohgo.com/docs/terms-of-use", /Terms of Use/, 2500, 1);
await around("Illinois IDOT reuse policy", "https://travelmidwest.com/About/InfoReusePolicy", /(reuse|policy)/, 1500, 2);
await around("WSDOT camera page", "https://wsdot.wa.gov/travel/traffic-cameras", /(camera|use)/, 500, 3);
await around("WSDOT disclaimer", "https://wsdot.wa.gov/about/policies/disclaimer", /(camera|disclaim|use)/, 500, 3);
await around("Alabama ALGO terms", "https://algotraffic.com/terms", /(terms|use)/, 800, 2);
await around("SD511 terms", "https://www.sd511.org/terms", /(terms|use|camera)/, 600, 2);
