// Temporary: runs the new feeds against the live services (removed after merge).
import { climateFeed } from "../src/lib/feeds/climate";
import { forecasterNotesFeed } from "../src/lib/feeds/forecaster-notes";
import { wildfiresFeed } from "../src/lib/feeds/wildfires";
import { slotOf, isoDateIn } from "../src/lib/climate";

const sp = (lat: number, lon: number) => new URLSearchParams({ lat: String(lat), lon: String(lon) });
const run = async (label: string, fn: () => Promise<unknown>) => {
  const t = Date.now();
  try {
    const v = await fn();
    console.log(`\n### ${label} (${Date.now() - t} ms)\n${JSON.stringify(v, null, 1).slice(0, 2000)}`);
  } catch (e) {
    console.log(`\n### ${label} ERROR`, (e as Error).message, (e as { status?: number }).status);
  }
};
const UA = { "User-Agent": "StormCentral/0.1 (github.com/KingCreeper531/StormCentral)" };
const boi = await (await fetch("https://api.weather.gov/products/types/AFD/locations/BOI", { headers: UA })).json();
const text = (await (await fetch(`https://api.weather.gov/products/${boi["@graph"][0].id}`, { headers: UA })).json()).productText;
console.log("### RAW BOI\n" + text.slice(0, 6000));

const places: Record<string, [number, number]> = {
  pittsburgh: [40.44, -80.0], losangeles: [34.05, -118.25], boise: [43.6, -116.2], houston: [29.76, -95.37], norman: [35.22, -97.44],
  minneapolis: [44.98, -93.27], seattle: [47.61, -122.33], miami: [25.76, -80.19], ruralnevada: [39.5, -117.0], anchorage: [61.22, -149.9], london: [51.5, -0.12],
};
for (const [name, [lat, lon]] of Object.entries(places)) {
  await run(`${name} climate`, async () => {
    const c = await climateFeed.load(sp(lat, lon));
    const s = slotOf(isoDateIn(Date.now(), "America/Chicago"));
    return { station: c.station, d: Math.round(c.distanceKm), years: c.recordYears, hi: c.hi[s], lo: c.lo[s], p: c.precip[s], recHi: [c.recHi[s], c.recHiYear[s]], recLo: [c.recLo[s], c.recLoYear[s]], wet: [c.recPrecip[s], c.recPrecipYear[s]], nullHi: c.hi.filter((v) => v == null).length, nullRec: c.recHi.filter((v) => v == null).length };
  });
  await run(`${name} notes`, async () => {
    const r = await forecasterNotesFeed.load(sp(lat, lon));
    return { office: r.office, summary: r.summary?.kind, items: r.summary?.items.map((i) => i.slice(0, 120)), sections: r.sections.map((s) => `${s.title} | ${s.period} | ${s.specialty} | ${s.paragraphs.length} | ${s.paragraphs[0]?.slice(0, 80)}`), glossary: r.glossary.length };
  });
}
await run("losangeles fires", async () => (await wildfiresFeed.load(sp(34.05, -118.25))).fires.map((f) => `${f.name} ${f.acres} ${Math.round(f.distanceKm)}km ${f.discovered}`));
