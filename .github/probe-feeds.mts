// Temporary: runs the new feeds against the live services (removed after merge).
import { climateFeed } from "../src/lib/feeds/climate";
import { floodGaugesFeed } from "../src/lib/feeds/flood-gauges";
import { forecasterNotesFeed } from "../src/lib/feeds/forecaster-notes";
import { wildfiresFeed } from "../src/lib/feeds/wildfires";
import { fetchAirQuality, fetchRecentPrecip } from "../src/lib/api/open-meteo";
import { rainTotals } from "../src/lib/rainfall";
import { smokeOutlook } from "../src/lib/fire-weather";
import { slotOf, isoDateIn } from "../src/lib/climate";

const places = { pittsburgh: [40.44, -80.0], losangeles: [34.05, -118.25], boise: [43.6, -116.2], houston: [29.76, -95.37], london: [51.5, -0.12] } as const;
const sp = (lat: number, lon: number) => new URLSearchParams({ lat: String(lat), lon: String(lon) });
const show = (label: string, v: unknown) => console.log(`\n### ${label}\n${JSON.stringify(v, null, 1).slice(0, 2500)}`);
const run = async (label: string, fn: () => Promise<unknown>) => {
  const t = Date.now();
  try {
    show(`${label} (${Date.now() - t}ms start)`, await fn());
  } catch (e) {
    console.log(`\n### ${label} ERROR`, (e as Error).message, (e as { status?: number }).status);
  }
};
for (const [name, [lat, lon]] of Object.entries(places)) {
  await run(`${name} notes`, async () => {
    const r = await forecasterNotesFeed.load(sp(lat, lon));
    return { office: r.office, officeName: r.officeName, issued: r.issued, summary: r.summary, changes: r.changes, sections: r.sections.map((s) => `${s.title} | ${s.period} | ${s.specialty} | ${s.paragraphs.length} | ${s.paragraphs[0]?.slice(0, 100)}`), glossary: r.glossary.map((g) => g.term) };
  });
  await run(`${name} gauges`, () => floodGaugesFeed.load(sp(lat, lon)));
  await run(`${name} fires`, async () => {
    const r = await wildfiresFeed.load(sp(lat, lon));
    return { n: r.fires.length, first: r.fires.slice(0, 3) };
  });
  await run(`${name} climate`, async () => {
    const t0 = Date.now();
    const c = await climateFeed.load(sp(lat, lon));
    const s = slotOf(isoDateIn(Date.now(), "America/New_York"));
    return { ms: Date.now() - t0, lat: c.lat, lon: c.lon, years: c.recordYears, today: { hi: c.hi[s], lo: c.lo[s], p: c.precip[s], recHi: c.recHi[s], recHiY: c.recHiYear[s], recLo: c.recLo[s], recLoY: c.recLoYear[s] }, nulls: c.hi.filter((v) => v == null).length, size: JSON.stringify(c).length };
  });
  await run(`${name} rain`, async () => rainTotals(await fetchRecentPrecip(lat, lon), Date.now()));
  await run(`${name} smoke`, async () => smokeOutlook(await fetchAirQuality(lat, lon), Date.now()));
}
