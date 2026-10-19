import type { ProductsResponse, ScansResponse } from "../api/types";
import { gridTimes, INTL_RADARS, isIntlRadarId, JMA_TIMES_URL, parseJmaTimes, type IntlRadarId } from "../radar/intl";
import { noaaCapabilitiesUrl, parseTimeDimension } from "../radar/noaa";
import { alternateProducts } from "../radar/products";
import { parseIemProducts, parseIemScans } from "./parse";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, upstreamJson, upstreamText } from "./upstream";

const IEM_RADAR = "https://mesonet.agron.iastate.edu/json/radar.py";
const isoMinute = (t: number) => new Date(t).toISOString().slice(0, 16) + "Z";

/**
 * `site=LOT&product=N0B&minutes=90`: volume-scan index from IEM. When the site
 * has no scans of that code, tries the same moment's other codes (N0G → N0U …)
 * and reports which one it found in `product`.
 */
export const radarScansFeed: Feed<ScansResponse> = {
  path: "/api/radar/scans",
  maxAge: 30,
  async load(sp) {
    const site = (sp.get("site") ?? "").toUpperCase();
    const product = (sp.get("product") ?? "").toUpperCase();
    const minutes = Math.min(240, Math.max(15, Number(sp.get("minutes")) || 90));
    if (!/^[A-Z]{3,6}$/.test(site) || !/^[A-Z0-9]{3}$/.test(product)) throw badParams("invalid site/product");

    // Round the window to the minute so concurrent clients share a cache key.
    const end = Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
    const start = end - minutes * 60_000;
    const list = async (code: string) =>
      parseIemScans(await upstreamJson(`${IEM_RADAR}?operation=list&radar=${site}&product=${code}&start=${isoMinute(start)}&end=${isoMinute(end)}`));
    return cached(`scans:${site}:${product}:${minutes}:${end}`, 30_000, async () => {
      const scans = await list(product);
      if (scans.length) return { site, product, scans };
      for (const alt of alternateProducts(product)) {
        const altScans = await list(alt).catch(() => []);
        if (altScans.length) return { site, product: alt, scans: altScans };
      }
      return { site, product, scans };
    });
  },
};

/** `site=LOT`: Level-III products IEM has for the last hour. */
export const radarProductsFeed: Feed<ProductsResponse> = {
  path: "/api/radar/products",
  maxAge: 600,
  async load(sp) {
    const site = (sp.get("site") ?? "").toUpperCase();
    if (!/^[A-Z]{3,6}$/.test(site)) throw badParams("invalid site");
    const start = new Date(Math.floor(Date.now() / 600_000) * 600_000 - 3_600_000).toISOString().slice(0, 16) + "Z";
    return cached(`products:${site}:${start}`, 10 * 60_000, async () => {
      // IEM documents `available`; `products` is the older name, kept as a fallback.
      const ask = (op: string) => upstreamJson(`${IEM_RADAR}?operation=${op}&radar=${site}&start=${start}`).then(parseIemProducts);
      let products = await ask("available").catch(() => [] as string[]);
      if (!products.length) products = await ask("products").catch(() => [] as string[]);
      return { site, products };
    });
  },
};

export interface NoaaTimesResponse {
  workspace: string;
  layer: string;
  /** ISO times NOAA has for the layer, oldest first. */
  times: string[];
}

/**
 * `workspace=conus&layer=conus_bref_qcd&minutes=90`: the times NOAA's
 * GeoServer (radar.weather.gov's backend) has for an MRMS or NEXRAD layer.
 */
export const noaaTimesFeed: Feed<NoaaTimesResponse> = {
  path: "/api/radar/noaa",
  maxAge: 30,
  async load(sp) {
    const workspace = (sp.get("workspace") ?? "").toLowerCase();
    const layer = (sp.get("layer") ?? "").toLowerCase();
    const minutes = Math.min(250, Math.max(10, Number(sp.get("minutes")) || 90));
    if (!/^[a-z]{4,10}$/.test(workspace) || !/^[a-z0-9_]{4,40}$/.test(layer) || !layer.startsWith(`${workspace}_`)) throw badParams("invalid workspace/layer");
    const all = await cached(`noaa:${layer}`, 30_000, async () => parseTimeDimension(await upstreamText(noaaCapabilitiesUrl({ workspace, layer }), { timeoutMs: 15_000 })));
    const newest = Date.parse(all.at(-1) ?? "");
    const times = Number.isFinite(newest) ? all.filter((t) => Date.parse(t) >= newest - minutes * 60_000) : [];
    return { workspace, layer, times };
  },
};

export interface IntlTimesResponse {
  src: IntlRadarId;
  /** ISO times the source has (observed frames only), oldest first. */
  times: string[];
}

/** `src=eccc&minutes=180`: the times another country's radar composite has (lib/radar/intl). */
export const intlTimesFeed: Feed<IntlTimesResponse> = {
  path: "/api/radar/intl",
  maxAge: 60,
  async load(sp) {
    const src = sp.get("src");
    if (!isIntlRadarId(src)) throw badParams("invalid src");
    const minutes = Math.min(250, Math.max(10, Number(sp.get("minutes")) || 120));
    const r = INTL_RADARS[src];
    const now = Date.now();
    let all: string[];
    if (r.times === "grid") all = gridTimes(r, now, 250);
    else if (r.times === "jma") all = await cached("intl:jma", 60_000, async () => parseJmaTimes(await upstreamJson<{ basetime?: string; validtime?: string }[]>(JMA_TIMES_URL)));
    else all = await cached(`intl:${src}`, 120_000, async () => parseTimeDimension(await upstreamText(r.capsUrl!, { timeoutMs: 15_000 })));
    // Capabilities can list nowcast steps past the present: observed frames only.
    const past = all.filter((t) => Date.parse(t) <= now + 60_000);
    const newest = Date.parse(past.at(-1) ?? "");
    const times = Number.isFinite(newest) ? past.filter((t) => Date.parse(t) >= newest - minutes * 60_000) : [];
    return { src, times };
  },
};
