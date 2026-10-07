#!/usr/bin/env node
/**
 * Vendors the Makin-Things weather icon set (MIT) into /public/icons/weather.
 * Icons are served same-origin and rendered through <img>, which keeps each
 * SVG's internal CSS animations isolated (no id/class collisions in the DOM).
 *
 *   npm run icons:sync
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://raw.githubusercontent.com/Makin-Things/weather-icons/main";
const OUT = path.resolve(process.cwd(), "public/icons/weather");

const NAMES = [
  "clear-day", "clear-night", "cloudy", "cloudy-1-day", "cloudy-1-night",
  "cloudy-2-day", "cloudy-2-night", "cloudy-3-day", "cloudy-3-night", "dust",
  "fog", "fog-day", "fog-night", "frost", "frost-day", "frost-night", "hail",
  "haze", "haze-day", "haze-night", "hurricane", "isolated-thunderstorms",
  "isolated-thunderstorms-day", "isolated-thunderstorms-night",
  "rain-and-sleet-mix", "rain-and-snow-mix", "rainy-1", "rainy-1-day",
  "rainy-1-night", "rainy-2", "rainy-2-day", "rainy-2-night", "rainy-3",
  "rainy-3-day", "rainy-3-night", "scattered-thunderstorms",
  "scattered-thunderstorms-day", "scattered-thunderstorms-night",
  "severe-thunderstorm", "snow-and-sleet-mix", "snowy-1", "snowy-1-day",
  "snowy-1-night", "snowy-2", "snowy-2-day", "snowy-2-night", "snowy-3",
  "snowy-3-day", "snowy-3-night", "thunderstorms", "tornado", "tropical-storm",
  "wind",
];

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function main() {
  for (const variant of ["animated", "static"]) {
    await mkdir(path.join(OUT, variant), { recursive: true });
    await Promise.all(
      NAMES.map(async (name) => {
        const svg = await fetchText(`${BASE}/${variant}/${name}.svg`);
        await writeFile(path.join(OUT, variant, `${name}.svg`), svg);
      }),
    );
    console.log(`✓ ${variant}: ${NAMES.length} icons`);
  }
  await writeFile(path.join(OUT, "LICENSE"), await fetchText(`${BASE}/LICENSE`));
  console.log(`Icons written to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
