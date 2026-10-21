// Temporary: finds agencies' official contact addresses for camera permission requests. Removed after use.
// Role addresses are printed; anything that looks like a person's own address is masked (CI logs are public).
const get = async (url) => { try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (StormCentral contact lookup)" }, signal: AbortSignal.timeout(30_000), redirect: "follow" }); return { status: r.status, url: r.url, text: r.ok ? await r.text() : "" }; } catch (e) { return { status: `ERR ${e.cause?.code ?? e.message}`, text: "" }; } };
const cf = (hex) => { const k = parseInt(hex.slice(0, 2), 16); let s = ""; for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k); return s; };
const personal = (local) => /^[a-z]+[._-][a-z]+\d*$/i.test(local) && !/^(dot|info|help|contact|support|web|traffic|data|gis|public|media|news|ask|customer|service|511|its|tmc|ops|operations|outreach|communications)/i.test(local);
const show = (e) => { const [l, d] = e.split("@"); return personal(l) ? `${l[0]}***@${d} (person, masked)` : e; };
function emails(html) {
  const decoded = html.replace(/data-cfemail="([0-9a-f]+)"/gi, (_, h) => ` ${cf(h)} `).replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, (_, h) => ` ${cf(h)} `);
  const text = decoded.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const out = new Map();
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) if (!out.has(m[0].toLowerCase())) out.set(m[0].toLowerCase(), text.slice(Math.max(0, m.index - 160), m.index).trim());
  return out;
}
async function look(name, url) {
  const r = await get(url);
  console.log(`\n=== ${name}: ${url} → ${r.status}`);
  for (const [e, before] of emails(r.text)) console.log(`  ${show(e)}   ← …${before.slice(-140)}`);
  return r.text;
}
await look("Iowa DOT terms (permission section)", "https://iowadot.gov/policies_and_statements/terms-of-use");
await look("Nebraska DOT policies", "https://dot.nebraska.gov/policies-and-disclaimers/");
await look("Nebraska DOT contact", "https://dot.nebraska.gov/contact/");
await look("Nebraska 511", "https://511.nebraska.gov/");
const wsLayer = await get("https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0?f=json");
console.log(`\n=== WSDOT camera layer → ${wsLayer.status}`);
for (const [e] of emails(wsLayer.text.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\"/g, '"'))) console.log(`  ${show(e)}`);
await look("WSDOT contact", "https://wsdot.wa.gov/about/contacts");
await look("WSDOT traveler API", "https://wsdot.wa.gov/traffic/api/");
const algo = await look("ALGO Traffic", "https://algotraffic.com/");
for (const src of [...algo.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], "https://algotraffic.com/").href).slice(0, 6)) await look("ALGO script", src);
await look("ALDOT contact", "https://www.dot.state.al.us/contact.html");
await look("SD511", "https://www.sd511.org/");
await look("SDDOT contact", "https://dot.sd.gov/contact-us");
