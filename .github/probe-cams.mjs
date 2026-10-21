// Temporary: checks camera sources and their terms from a CI runner. Removed after use.
const UA = { "User-Agent": "StormCentral-probe (github.com/KingCreeper531/StormCentral)" };
const get = async (url, init = {}) => {
  try {
    const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
    return r;
  } catch (e) { return { ok: false, status: `ERR ${e.cause?.code ?? e.message}`, headers: new Headers(), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) }; }
};
async function image(url) {
  const r = await get(url);
  const b = r.ok ? (await r.arrayBuffer()).byteLength : 0;
  return `${r.status} ${r.headers.get("content-type")} ${b}B ${url}`;
}
async function list(name, url, pick, init) {
  console.log(`\n=== ${name}\n${url}`);
  const r = await get(url, init);
  console.log(`status ${r.status}`);
  if (!r.ok) return;
  let j; try { j = JSON.parse(await r.text()); } catch { return console.log("not JSON"); }
  const { rows, sample, images } = pick(j);
  console.log(`cameras: ${rows}`);
  console.log(`sample: ${JSON.stringify(sample).slice(0, 700)}`);
  for (const u of images.slice(0, 3)) console.log(`image: ${await image(u)}`);
}
const KEYWORDS = /(licen[cs]e|reuse|re-use|redistribut|commercial|permission|courtesy|attribution|public domain|personal use|consent|copyright|third[- ]party|embed|camera images|images (may|are))/i;
async function terms(name, url) {
  console.log(`\n--- TERMS ${name}\n${url}`);
  const r = await get(url);
  console.log(`status ${r.status}`);
  if (!r.ok) return;
  const text = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const hits = text.split(/(?<=[.!?])\s+/).filter((s) => KEYWORDS.test(s)).map((s) => s.trim().slice(0, 320));
  for (const s of [...new Set(hits)].slice(0, 14)) console.log(`> ${s}`);
  if (!hits.length) console.log("(no matching sentences)");
}
const feats = (j) => j.features ?? [];

await list("Iowa DOT (ArcGIS)", "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=2000",
  (j) => ({ rows: feats(j).length, sample: feats(j)[0], images: feats(j).map((f) => f.properties?.ImageURL).filter(Boolean) }));
const ia = await get("https://data.iowa.gov/api/views/4bfg-n52x.json");
if (ia.ok) { const m = await ia.json(); console.log(`data.iowa.gov 4bfg-n52x: name=${m.name} license=${JSON.stringify(m.license)} attribution=${m.attribution} updated=${m.rowsUpdatedAt}`); } else console.log(`data.iowa.gov meta: ${ia.status}`);

await list("WSDOT (ArcGIS)", "https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json",
  (j) => ({ rows: feats(j).length, sample: feats(j)[0], images: feats(j).map((f) => f.attributes?.ImageURL).filter(Boolean) }));
const ws = await get("https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer?f=json");
if (ws.ok) { const m = await ws.json(); console.log(`WSDOT service: copyrightText=${JSON.stringify(m.copyrightText)} licenseInfo=${JSON.stringify(m.documentInfo ?? m.licenseInfo ?? null).slice(0, 600)}`); }
const wsl = await get("https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0?f=json");
if (wsl.ok) { const m = await wsl.json(); console.log(`WSDOT layer: copyrightText=${JSON.stringify(m.copyrightText)} description=${JSON.stringify(m.description).slice(0, 600)}`); }

await list("Nebraska NDOT (ArcGIS)", "https://giscat.ne.gov/dot/rest/services/HighwayCamerasDOT/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json",
  (j) => ({ rows: feats(j).length, sample: feats(j)[0], images: feats(j).map((f) => f.attributes?.PhotoURL).filter(Boolean) }));
await list("Kentucky KYTC (ArcGIS)", "https://services2.arcgis.com/CcI36Pduqd0OR4W9/arcgis/rest/services/trafficCamerasCur_Prd/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json",
  (j) => ({ rows: feats(j).length, sample: feats(j)[0], images: feats(j).map((f) => String(f.attributes?.snapshot ?? "").replace(/^http:/, "https:")).filter(Boolean) }));
await list("Alabama ALGO", "https://api.algotraffic.com/v4.0/Cameras",
  (j) => ({ rows: Array.isArray(j) ? j.length : 0, sample: Array.isArray(j) ? j[0] : j, images: Array.isArray(j) ? j.map((c) => c.snapshotImageUrl).filter(Boolean) : [] }));
await list("South Dakota (Iteris)", "https://sd.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson",
  (j) => ({ rows: feats(j).length, sample: feats(j)[0], images: feats(j).flatMap((f) => (f.properties?.cameras ?? []).map((c) => c.image)).filter(Boolean) }));

await terms("Iowa DOT site", "https://iowadot.gov/disclaimer");
await terms("WSDOT traffic API", "https://wsdot.wa.gov/traffic/api/");
await terms("WSDOT web policies", "https://wsdot.wa.gov/about/policies/web-policies");
await terms("Nebraska DOT policies", "https://dot.nebraska.gov/policies-and-disclaimers/");
await terms("Ohio OHGO terms", "https://publicapi.ohgo.com/docs/terms-of-use");
await terms("Ohio OHGO intro", "https://publicapi.ohgo.com/docs/v1/introduction");
await terms("Oregon TripCheck FAQ", "https://tripcheck.com/pages/frequently-asked-questions");
await terms("Illinois IDOT reuse policy", "https://travelmidwest.com/About/InfoReusePolicy");
await terms("Kentucky KYTC disclaimer", "https://transportation.ky.gov/Pages/Disclaimer.aspx");
await terms("Alabama ALGO", "https://algotraffic.com/terms");
