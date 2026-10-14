/**
 * The morning severe weather outlook: waits for SPC's 13Z Day 1 outlook (and
 * for its map files to match the text), then one Short of it.
 */
import { parseOutlook, RISKS } from "../../bot/outlook";
import {
  descriptionFor,
  descriptionForEs,
  drawable,
  maxProbability,
  outlookDay,
  regionOf,
  RISK_CODES,
  tagsFor,
  titleFor,
  titleForEs,
  type GeoCollection,
} from "../meta";
import { getJson, readVendor } from "../source";
import type { Kind, KindContext } from "../video";

const NWS = "https://api.weather.gov";
const SPC = "https://www.spc.noaa.gov/products/outlook";

interface Fetched {
  text: string;
  issued: number;
  cat: GeoCollection;
  torn: GeoCollection;
  wind: GeoCollection;
  hail: GeoCollection;
}

async function fetchOutlook(ctx: KindContext): Promise<Fetched> {
  let swo: { productText: string; issuanceTime: string };
  if (ctx.fixtures) swo = await getJson(ctx, "swody1.json", "");
  else {
    const list = await getJson<{ "@graph"?: { id: string }[] }>(ctx, "swo-list.json", `${NWS}/products/types/SWO/locations/DY1`);
    const id = list["@graph"]?.[0]?.id;
    if (!id) throw new Error("No Day 1 outlook listed");
    swo = await getJson(ctx, "swody1.json", `${NWS}/products/${id}`);
  }
  const [cat, torn, wind, hail] = await Promise.all(
    (["cat", "torn", "wind", "hail"] as const).map((k) => getJson<GeoCollection>(ctx, `day1_${k}.geojson`, `${SPC}/day1otlk_${k}.lyr.geojson`)),
  );
  return { text: swo.productText, issued: Date.parse(swo.issuanceTime), cat: cat!, torn: torn!, wind: wind!, hail: hail! };
}

/** "141300Z" → the YYYYMMDDHHMM SPC puts in its GeoJSON (VALID), for the outlook issued at `issued`. */
const validStamp = (validFrom: string, issued: number) => `${new Date(issued).toISOString().slice(0, 8).replace(/-/g, "")}${validFrom.slice(0, 2)}${validFrom.slice(2, 6)}`;

/** Today's morning outlook, waiting for it up to SHORTS_WAIT_MIN (default 50) minutes. */
async function morningOutlook(ctx: KindContext) {
  const { env } = ctx;
  const deadline = Date.now() + Math.max(0, Number(env.SHORTS_WAIT_MIN ?? 50)) * 60_000;
  const today = new Date().toISOString().slice(0, 10);
  for (;;) {
    const f = await fetchOutlook(ctx);
    const o = parseOutlook(f.text);
    if (o && (env.SHORTS_LATEST === "1" || ctx.fixtures)) return { f, o };
    const sameDay = new Date(f.issued).toISOString().slice(0, 10) === today;
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

export const outlookKind: Kind = async (ctx) => {
  const { f, o } = await morningOutlook(ctx);
  const region = o.risk ? regionOf(f.text) : "";
  const hazards = { tornado: maxProbability(f.torn), wind: maxProbability(f.wind), hail: maxProbability(f.hail) };
  console.log(`Outlook ${o.validFrom}: ${o.risk ?? "no severe risk"}${region ? ` for the ${region}` : ""}; tornado ${hazards.tornado}%, wind ${hazards.wind}%, hail ${hazards.hail}%.`);
  if (!o.risk && ctx.env.SHORTS_SKIP_QUIET === "true") {
    console.log("No severe risk today; no video (SHORTS_SKIP_QUIET).");
    return [];
  }
  return [
    {
      key: "outlook",
      template: "outlook.html",
      title: titleFor(o, region, f.issued),
      description: descriptionFor(o, region, hazards),
      tags: tagsFor(o, region),
      es: { title: titleForEs(o, f.issued), description: descriptionForEs(o, region, hazards) },
      playlist: "Daily Severe Weather Outlook",
      data: {
        states: readVendor("states-10m.json"),
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
    },
  ];
};
