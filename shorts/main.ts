/**
 * The daily outlook Short: waits for SPC's morning (13Z) Day 1 outlook, draws
 * the video (render.ts) and uploads it to YouTube (youtube.ts). GitHub
 * Actions runs it every morning (.github/workflows/youtube-shorts.yml); see
 * shorts/README.md.
 *
 * Environment:
 *   YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN  YouTube credentials (missing → render only)
 *   SHORTS_UPLOAD=1        upload the video (otherwise it's only rendered)
 *   SHORTS_PRIVACY         public (default), unlisted or private
 *   SHORTS_WAIT_MIN        minutes to wait for today's morning outlook (default 50)
 *   SHORTS_LATEST=1        use the latest Day 1 outlook, whatever its time (manual test runs)
 *   SHORTS_SKIP_QUIET=true no video on days without a severe risk
 *   SHORTS_OUT             the MP4 (default shorts/out/outlook.mp4)
 *   SHORTS_FIXTURES        a folder of saved SPC/NWS files to use instead of fetching (testing)
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseOutlook, RISKS } from "../bot/outlook";
import { descriptionFor, drawable, maxProbability, outlookDay, regionOf, RISK_CODES, tagsFor, titleFor, type GeoCollection } from "./meta";
import { renderShort } from "./render";
import { accessToken, credentialsFromEnv, uploadVideo } from "./youtube";

const env = process.env;
const USER_AGENT = "StormCentralBot/1.0 (github.com/KingCreeper531/StormCentral)";
const NWS = "https://api.weather.gov";
const SPC = "https://www.spc.noaa.gov/products/outlook";
const out = env.SHORTS_OUT || "shorts/out/outlook.mp4";
const waitMs = Math.max(0, Number(env.SHORTS_WAIT_MIN ?? 50)) * 60_000;

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

interface Fetched {
  text: string;
  issued: number;
  cat: GeoCollection;
  torn: GeoCollection;
  wind: GeoCollection;
  hail: GeoCollection;
}

async function fetchOutlook(): Promise<Fetched> {
  if (env.SHORTS_FIXTURES) {
    const f = (name: string) => JSON.parse(readFileSync(join(env.SHORTS_FIXTURES!, name), "utf8"));
    const swo = f("swody1.json") as { productText: string; issuanceTime: string };
    return { text: swo.productText, issued: Date.parse(swo.issuanceTime), cat: f("day1_cat.geojson"), torn: f("day1_torn.geojson"), wind: f("day1_wind.geojson"), hail: f("day1_hail.geojson") };
  }
  const list = await get<{ "@graph"?: { id: string }[] }>(`${NWS}/products/types/SWO/locations/DY1`);
  const id = list["@graph"]?.[0]?.id;
  if (!id) throw new Error("No Day 1 outlook listed");
  const product = await get<{ productText: string; issuanceTime: string }>(`${NWS}/products/${id}`);
  const [cat, torn, wind, hail] = await Promise.all(["cat", "torn", "wind", "hail"].map((k) => get<GeoCollection>(`${SPC}/day1otlk_${k}.lyr.geojson`)));
  return { text: product.productText, issued: Date.parse(product.issuanceTime), cat: cat!, torn: torn!, wind: wind!, hail: hail! };
}

/** "141300Z" → the YYYYMMDDHHMM SPC puts in its GeoJSON (VALID), for the outlook issued at `issued`. */
const validStamp = (validFrom: string, issued: number) => `${new Date(issued).toISOString().slice(0, 8).replace(/-/g, "")}${validFrom.slice(0, 2)}${validFrom.slice(2, 6)}`;

/** Today's morning outlook, waiting for it (and for SPC's map files to match the text) up to SHORTS_WAIT_MIN. */
async function morningOutlook() {
  const deadline = Date.now() + waitMs;
  const today = new Date().toISOString().slice(0, 10);
  for (;;) {
    const f = await fetchOutlook();
    const o = parseOutlook(f.text);
    if (o && env.SHORTS_LATEST === "1") return { f, o };
    const sameDay = new Date(f.issued).toISOString().slice(0, 10) === today || !!env.SHORTS_FIXTURES;
    const morning = o && ["1300", "1630", "2000"].includes(o.cycle) && sameDay;
    // SPC's GeoJSON can lag the text by a few minutes; a day with no thunderstorms at all has no shapes to check.
    const shapes = drawable(f.cat).features;
    const matches = o && (shapes.length === 0 || shapes.some((x) => x.properties.VALID === validStamp(o.validFrom, f.issued)));
    if (o && morning && matches) return { f, o };
    const why = !o ? "no Day 1 outlook" : !morning ? `the latest is the ${o.cycle}Z outlook` : "SPC's map files don't match the text yet";
    if (Date.now() > deadline) {
      if (o && sameDay) {
        console.warn(`Gave up waiting (${why}); using what's there.`);
        return { f, o };
      }
      throw new Error(`No outlook for today (${why}).`);
    }
    console.log(`Waiting for today's morning outlook: ${why}.`);
    await new Promise((r) => setTimeout(r, 120_000));
  }
}

function setOutput(name: string, value: string) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  const { f, o } = await morningOutlook();
  const region = o.risk ? regionOf(f.text) : "";
  const hazards = { tornado: maxProbability(f.torn), wind: maxProbability(f.wind), hail: maxProbability(f.hail) };
  console.log(`Outlook ${o.validFrom}: ${o.risk ?? "no severe risk"}${region ? ` for the ${region}` : ""}; tornado ${hazards.tornado}%, wind ${hazards.wind}%, hail ${hazards.hail}%.`);
  if (!o.risk && env.SHORTS_SKIP_QUIET === "true") return console.log("No severe risk today; no video (SHORTS_SKIP_QUIET).");

  const meta = {
    title: titleFor(o, region, f.issued),
    description: descriptionFor(o, region, hazards),
    tags: tagsFor(o, region),
    privacy: ["public", "unlisted", "private"].includes(env.SHORTS_PRIVACY ?? "") ? env.SHORTS_PRIVACY! : "public",
  };
  writeFileSync(out.replace(/\.mp4$/, ".json"), JSON.stringify(meta, null, 2));
  console.log(`\nTitle: ${meta.title}\n\n${meta.description}\n`);

  const started = Date.now();
  await renderShort(
    {
      states: JSON.parse(readFileSync("shorts/vendor/states-10m.json", "utf8")),
      cat: drawable(f.cat),
      torn: drawable(f.torn),
      wind: drawable(f.wind),
      hail: drawable(f.hail),
      outlook: {
        risk: o.risk ? o.risk.charAt(0) + o.risk.slice(1).toLowerCase() : null,
        code: o.risk ? RISK_CODES[o.risk] : null,
        level: o.risk ? RISKS.indexOf(o.risk) + 1 : 0,
        region,
        summary: o.summary || "Severe thunderstorms are not expected today.",
        date: outlookDay(f.issued),
      },
    },
    out,
  );
  console.log(`Rendered ${out} in ${Math.round((Date.now() - started) / 1000)} s.`);

  const creds = credentialsFromEnv();
  if (env.SHORTS_UPLOAD !== "1" || !creds) return console.log(creds ? "Not uploading (SHORTS_UPLOAD isn't 1)." : "No YouTube credentials; rendered only.");
  const id = await uploadVideo(out, meta, await accessToken(creds));
  console.log(`Uploaded → https://youtube.com/shorts/${id}`);
  setOutput("uploaded", "true");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
