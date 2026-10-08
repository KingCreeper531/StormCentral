import type { OutlookKind, OutlookResponse } from "../api/types";
import { parseSpcOutlook, parseSpcProbOutlook, type SpcHazard } from "./parse";
import { cached } from "./cache";
import type { Feed } from "./types";
import { badParams, upstreamJson } from "./upstream";

/** `OutlookResponse` plus when the outlook period ends (ISO; SPC Day 1 runs to 12Z the next morning). */
export type OutlookFeedResponse = OutlookResponse & { expires: string | null };

const KINDS: readonly OutlookKind[] = ["categorical", "tornado", "hail", "wind"];
const isKind = (k: string): k is OutlookKind => (KINDS as readonly string[]).includes(k);

/** SPC file stems: the hazard's probabilities and its hatched significant-severe area. */
const FILES: Record<SpcHazard, { prob: string; sig: string }> = {
  tornado: { prob: "torn", sig: "sigtorn" },
  hail: { prob: "hail", sig: "sighail" },
  wind: { prob: "wind", sig: "sigwind" },
};

const spc = (file: string) =>
  upstreamJson(`https://www.spc.noaa.gov/products/outlook/${file}.lyr.geojson`, {
    headers: { Accept: "application/geo+json, application/json" },
  });

/**
 * SPC convective outlook polygons.
 * - `day=1|2|3`, `kind=categorical` (default): TSTM through HIGH.
 * - `day=1`, `kind=tornado|hail|wind`: the hazard's probability contours plus
 *   its significant-severe areas (`significant: true`), lowest rank first.
 *   SPC only issues per-hazard probabilities for Day 1; other days get a 400.
 */
export const outlookFeed: Feed<OutlookFeedResponse> = {
  path: "/api/outlook",
  maxAge: 600,
  async load(sp) {
    const day = Number(sp.get("day") ?? 1);
    const d = (day === 2 || day === 3 ? day : 1) as 1 | 2 | 3;
    const kind = sp.get("kind") || "categorical";
    if (!isKind(kind)) throw badParams("kind must be categorical, tornado, hail or wind");
    if (kind !== "categorical" && d !== 1) throw badParams("Tornado, hail and wind probabilities are only issued for day 1");

    return cached(`spc:${d}:${kind}`, 10 * 60_000, async (): Promise<OutlookFeedResponse> => {
      if (kind === "categorical") return { day: d, kind, ...parseSpcOutlook(await spc(`day${d}otlk_cat`)) };

      // The significant-severe file is a bonus: losing it must not lose the probabilities.
      const [prob, sig] = await Promise.allSettled([spc(`day1otlk_${FILES[kind].prob}`), spc(`day1otlk_${FILES[kind].sig}`)]);
      if (prob.status === "rejected") throw prob.reason;
      const p = parseSpcProbOutlook(prob.value, kind);
      const s = sig.status === "fulfilled" ? parseSpcProbOutlook(sig.value, kind, { significant: true }) : null;
      return {
        day: 1,
        kind,
        // Probabilities by rank, then the significant areas on top.
        features: [...p.features, ...(s?.features ?? [])].sort((a, b) => a.properties.rank - b.properties.rank),
        valid: p.valid ?? s?.valid ?? null,
        expires: p.expires ?? s?.expires ?? null,
      };
    });
  },
};
