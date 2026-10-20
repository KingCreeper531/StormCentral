#!/usr/bin/env node
/**
 * County lines for the map when zoomed out (lib/map/style.ts). The basemap's
 * vector tiles only carry US county borders from zoom 9, so for the whole
 * country at once the map draws these instead: the borders between counties
 * of the same state (state lines come from the basemap), from the US Census
 * Bureau's 1:10,000,000 cartographic boundaries as packaged by us-atlas, as
 * one GeoJSON MultiLineString rounded to about 100 m.
 * Runs on postinstall; without us-atlas (a production-only install) it skips,
 * and the map shows county lines from zoom 9 as before.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const outFile = path.resolve(process.cwd(), "public/vendor/us-county-lines.json");

let topology, mesh;
try {
  topology = require("us-atlas/counties-10m.json");
  ({ mesh } = await import("topojson-client"));
} catch {
  console.warn("! us-atlas or topojson-client not installed; skipping county lines");
  process.exit(0);
}

// County ids are 5-digit FIPS codes: the first two are the state.
const state = (f) => String(f.id).padStart(5, "0").slice(0, 2);
const lines = mesh(topology, topology.objects.counties, (a, b) => a !== b && state(a) === state(b));
const round = (n) => Math.round(n * 1000) / 1000;
const coordinates = lines.coordinates
  .map((line) => line.map(([x, y]) => [round(x), round(y)]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]))
  .filter((line) => line.length > 1);

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates } }));
console.log(`✓ ${coordinates.length} county line segments written to public/vendor/`);
