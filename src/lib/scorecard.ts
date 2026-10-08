/**
 * "Forecast vs. reality": did the forecast model show the weather a spotter
 * reported? Every report carries a snapshot of the model's conditions at that
 * place and time (`posts.conditions`); this module scores those snapshots.
 * Pure and shared by the API route (server) and the scorecard page (client).
 */
import type { Category } from "./community";

/** Report windows the scorecard offers, in days. */
export const SCORECARD_WINDOWS = [7, 30, 90] as const;
export type ScorecardWindow = (typeof SCORECARD_WINDOWS)[number];
export const DEFAULT_WINDOW: ScorecardWindow = 30;

/** Below this many scored reports the page shows an empty state instead of a hit rate. */
export const MIN_SCORED = 5;
/** How many recent misses the summary lists. */
export const MISS_LIMIT = 10;
/** Misses list only reports at or above this severity ("Significant", "Dangerous"). */
export const MISS_MIN_SEVERITY = 2;

/** Wind damage counts as forecast when the model had gusts or sustained wind at or above these. */
export const WIND_GUST_MS = 15; // ≈ 34 mph
export const WIND_SUSTAINED_MS = 11; // ≈ 25 mph
/** Rain and flooding also count as forecast when the model had this much precipitation or this probability. */
export const PRECIP_MM = 0.2;
export const PRECIP_PROB = 50;

/**
 * The model fields scoring reads. Matches the stored snapshot; `precipMm`
 * (current hour) and `precipProb` are optional so older snapshots still score.
 */
export interface ModelSnapshot {
  tempC?: number | null;
  code: number | null;
  windMs: number | null;
  gustMs: number | null;
  precipMm?: number | null;
  precipProb?: number | null;
}

/** Categories that describe a specific hazard the model can be checked against. */
export const SCORED_CATEGORIES = ["rain", "flooding", "snow", "hail", "lightning", "tornado", "wind", "fog"] as const satisfies readonly Category[];
export type ScoredCategory = (typeof SCORED_CATEGORIES)[number];

export function isScoredCategory(c: string): c is ScoredCategory {
  return (SCORED_CATEGORIES as readonly string[]).includes(c);
}

// WMO 4677 groups (the subset Open-Meteo emits; see lib/weather/wmo.ts).
const FOG = new Set([45, 48]);
const FREEZING = new Set([56, 57, 66, 67]);
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const THUNDER = new Set([95, 96, 99]);
/** Drizzle 51–57, rain 61–67, showers 80–82, thunderstorm 95–99. */
const isWetCode = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || THUNDER.has(c);

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Short description of what the model had to show for a hit, per category. */
export const HIT_RULE: Record<ScoredCategory, string> = {
  rain: "Rain, drizzle, showers or thunderstorms",
  flooding: "Rain, drizzle, showers or thunderstorms",
  snow: "Snow or freezing precipitation",
  hail: "Thunderstorms",
  lightning: "Thunderstorms",
  tornado: "Thunderstorms",
  wind: "Strong gusts or sustained wind",
  fog: "Fog",
};

/**
 * Whether the model "saw" a report: true (hit), false (miss), or null when
 * the category isn't scored or the snapshot lacks the fields it needs.
 */
export function scoreReport(category: string, snap: ModelSnapshot | null | undefined): boolean | null {
  if (!snap || !isScoredCategory(category)) return null;
  const code = num(snap.code) ? snap.code : null;
  switch (category) {
    case "rain":
    case "flooding": {
      const mm = num(snap.precipMm) ? snap.precipMm : null;
      const prob = num(snap.precipProb) ? snap.precipProb : null;
      if (code == null && mm == null && prob == null) return null;
      return (code != null && isWetCode(code)) || (mm != null && mm > PRECIP_MM) || (prob != null && prob >= PRECIP_PROB);
    }
    case "snow":
      return code == null ? null : SNOW.has(code) || FREEZING.has(code);
    case "hail":
    case "lightning":
    case "tornado":
      return code == null ? null : THUNDER.has(code);
    case "wind": {
      const gust = num(snap.gustMs) ? snap.gustMs : null;
      const wind = num(snap.windMs) ? snap.windMs : null;
      if (gust == null && wind == null) return null;
      return (gust != null && gust >= WIND_GUST_MS) || (wind != null && wind >= WIND_SUSTAINED_MS);
    }
    case "fog":
      return code == null ? null : FOG.has(code);
  }
}

/** One report as the scorer sees it. */
export interface ScorableReport {
  id: string;
  category: string;
  severity: number;
  createdAt: number;
  place: string | null;
  username: string;
  conditions: ModelSnapshot | null;
}

export interface Score {
  /** Reports of this kind in the window. */
  reports: number;
  /** Reports with a forecast snapshot that has the fields this category needs. */
  scored: number;
  /** Scored reports where the model showed the reported weather. */
  hits: number;
  /** hits / scored, 0..1; null when nothing was scored. */
  hitRate: number | null;
}

export interface CategoryScore extends Score {
  category: ScoredCategory;
}

export interface ScorecardMiss {
  id: string;
  category: ScoredCategory;
  severity: number;
  place: string | null;
  username: string;
  createdAt: number;
  /** What the model showed at report time. */
  model: ModelSnapshot;
}

export interface ScorecardSummary {
  days: ScorecardWindow;
  /** Window start, epoch ms. */
  since: number;
  generatedAt: number;
  /** Totals over the scored categories. */
  overall: Score;
  /** One entry per scored category, in SCORED_CATEGORIES order. */
  categories: CategoryScore[];
  /** Observations and sky photos in the window (not scored). */
  unscoredReports: number;
  /** Most recent significant reports the model missed, newest first. */
  misses: ScorecardMiss[];
}

const rate = (hits: number, scored: number) => (scored > 0 ? hits / scored : null);

/** Keep only the model fields (no extra keys from future snapshot versions). */
function modelFields(s: ModelSnapshot): ModelSnapshot {
  const out: ModelSnapshot = { tempC: s.tempC ?? null, code: s.code, windMs: s.windMs, gustMs: s.gustMs };
  if (s.precipMm !== undefined) out.precipMm = s.precipMm;
  if (s.precipProb !== undefined) out.precipProb = s.precipProb;
  return out;
}

export function summarize(
  rows: readonly ScorableReport[],
  opts: { days: ScorecardWindow; since: number; now?: number; missLimit?: number },
): ScorecardSummary {
  const tally = new Map<ScoredCategory, Score>(SCORED_CATEGORIES.map((c) => [c, { reports: 0, scored: 0, hits: 0, hitRate: null }]));
  let unscoredReports = 0;
  const misses: ScorecardMiss[] = [];

  for (const r of rows) {
    if (!isScoredCategory(r.category)) {
      unscoredReports++;
      continue;
    }
    const t = tally.get(r.category)!;
    t.reports++;
    const hit = scoreReport(r.category, r.conditions);
    if (hit == null) continue;
    t.scored++;
    if (hit) t.hits++;
    else if (r.severity >= MISS_MIN_SEVERITY && r.conditions) {
      misses.push({
        id: r.id,
        category: r.category,
        severity: r.severity,
        place: r.place,
        username: r.username,
        createdAt: r.createdAt,
        model: modelFields(r.conditions),
      });
    }
  }

  const categories = SCORED_CATEGORIES.map((category) => {
    const t = tally.get(category)!;
    return { category, ...t, hitRate: rate(t.hits, t.scored) };
  });
  const overall = categories.reduce<Score>(
    (acc, c) => ({ reports: acc.reports + c.reports, scored: acc.scored + c.scored, hits: acc.hits + c.hits, hitRate: null }),
    { reports: 0, scored: 0, hits: 0, hitRate: null },
  );
  overall.hitRate = rate(overall.hits, overall.scored);

  misses.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));

  return {
    days: opts.days,
    since: opts.since,
    generatedAt: opts.now ?? Date.now(),
    overall,
    categories,
    unscoredReports,
    misses: misses.slice(0, opts.missLimit ?? MISS_LIMIT),
  };
}

/**
 * Parse the `days` query parameter: missing or empty → the default window,
 * one of 7/30/90 → that window, anything else → null (bad request).
 */
export function parseWindow(raw: string | null | undefined): ScorecardWindow | null {
  if (raw == null || raw === "") return DEFAULT_WINDOW;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return (SCORECARD_WINDOWS as readonly number[]).includes(n) ? (n as ScorecardWindow) : null;
}
