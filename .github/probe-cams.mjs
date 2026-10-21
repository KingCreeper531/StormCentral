// Temporary: confirms agencies' contact addresses appear on their own pages (prints found / not found only). Removed after use.
const get = async (url) => { try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (StormCentral contact check)" }, signal: AbortSignal.timeout(30_000), redirect: "follow" }); return { status: r.status, text: r.ok ? await r.text() : "" }; } catch (e) { return { status: `ERR ${e.cause?.code ?? e.message}`, text: "" }; } };
const cf = (hex) => { const k = parseInt(hex.slice(0, 2), 16); let s = ""; for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k); return s; };
const decode = (h) => h.replace(/data-cfemail="([0-9a-f]+)"/gi, (_, x) => ` ${cf(x)} `).replace(/email-protection#([0-9a-f]+)/gi, (_, x) => ` ${cf(x)} `).replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/&#64;|&#x40;/gi, "@").toLowerCase();
const checks = [
  ["Iowa DOT (Outreach & Development Bureau)", "dot-newsgroup@iowadot.us", ["https://iowadot.gov/policies-statements/linking-policy", "https://iowadot.gov/policies_and_statements/Linking-policy", "https://iowadot.gov/policies_and_statements/terms-of-use", "https://iowadot.gov/policies-statements/terms-use"]],
  ["WSDOT camera layer data contact", "thomas.stidham@wsdot.wa.gov", ["https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0?f=json", "https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/MapServer/info/iteminfo?f=json"]],
  ["ALDOT general contact", "aldotinfo@dot.state.al.us", ["https://www.aldot.gov/", "https://www.aldot.gov/contact.html", "https://www.dot.state.al.us/contact.html", "https://www.aldot.gov/travel.html"]],
];
for (const [name, address, pages] of checks) {
  console.log(`\n=== ${name}`);
  for (const p of pages) { const r = await get(p); console.log(`  ${decode(r.text).includes(address) ? "FOUND" : "not found"} (${r.status}) ${p}`); }
}
// Is there any role address on the Iowa linking policy page at all (masked: local part's first letter + domain)?
const lp = decode((await get("https://iowadot.gov/policies-statements/linking-policy")).text);
console.log(`\nIowa linking policy addresses: ${[...new Set(lp.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])].map((e) => e.replace(/^(.)[^@]*/, "$1***")).join(", ") || "none"}`);
