/**
 * The seasonal outlook (monthly): NOAA Climate Prediction Center's odds of a
 * warmer, colder, wetter or drier than normal three months, on the map, region
 * by region. CPC updates it on the third Thursday of each month at 8:30 AM
 * Eastern; the scheduled runs go on Thursdays and post only a fresh one (a
 * manual run posts the latest whenever). The season shown is the next
 * meteorological season (winter, spring, summer or fall) when it starts
 * within two months, so October's update is the Winter Outlook, and the next
 * three months otherwise.
 */
import { DISCLAIMER, DISCLAIMER_ES, fitTitle, LINK_LINE, LINK_LINE_ES } from "../meta";
import { getJson, readVendor } from "../source";
import type { Kind, KindContext, Video } from "../video";

/** CPC's outlook polygons as a NOAA map service, one layer per lead (layer 0 = lead 1). */
const SERVICES = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks";
/** About 5 km, a pixel of the 1080-pixel US map: a few hundred KB instead of 12 MB a layer, and quick to draw. */
const SIMPLIFY = "&outSR=4326&maxAllowableOffset=0.05&geometryPrecision=3";
/** A scheduled run posts the update only while it's this fresh. */
const FRESH_MS = 3 * 86_400_000;

export type Category = "Above" | "Below" | "Normal";
export type Variable = "temp" | "prcp";

export interface OutlookFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] } | null;
  properties: { cat: string; prob: number; valid_seas?: string; fcst_date?: number };
}
export interface OutlookCollection {
  type: "FeatureCollection";
  features: OutlookFeature[];
}

const MONTHS = "JFMAMJJASOND";
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTH_LONG_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const NAMED: Record<string, { en: string; es: string }> = {
  DJF: { en: "Winter", es: "invierno" },
  MAM: { en: "Spring", es: "primavera" },
  JJA: { en: "Summer", es: "verano" },
  SON: { en: "Fall", es: "otoño" },
};

export interface Season {
  /** "DJF". */
  code: string;
  /** "Winter", or null for a three months that isn't a meteorological season ("NDJ"). */
  name: string | null;
  nameEs: string | null;
  /** First month (0-11) and its year. */
  month: number;
  year: number;
  /** "Dec 2026 – Feb 2027" / "dic 2026 – feb 2027". */
  range: string;
  rangeEs: string;
  /** "December through February" / "diciembre a febrero". */
  spoken: string;
  spokenEs: string;
  /** "2026-27" or "2027", for titles. */
  years: string;
}

/** CPC's "DJF 2026-2027" (or "JFM 2027") → the months and years it covers; null when it isn't one. */
export function seasonOf(validSeas: string): Season | null {
  const m = /^([A-Z]{3})\s+(\d{4})/.exec(validSeas.trim());
  if (!m) return null;
  const code = m[1]!;
  const month = [...Array(12).keys()].find((i) => [0, 1, 2].map((k) => MONTHS[(i + k) % 12]).join("") === code);
  if (month == null) return null;
  const year = Number(m[2]);
  const endMonth = (month + 2) % 12;
  const endYear = month + 2 > 11 ? year + 1 : year;
  return {
    code,
    name: NAMED[code]?.en ?? null,
    nameEs: NAMED[code]?.es ?? null,
    month,
    year,
    range: `${MONTH_EN[month]} ${year} – ${MONTH_EN[endMonth]} ${endYear}`,
    rangeEs: `${MONTH_ES[month]} ${year} – ${MONTH_ES[endMonth]} ${endYear}`,
    spoken: `${MONTH_LONG[month]} through ${MONTH_LONG[endMonth]}`,
    spokenEs: `${MONTH_LONG_ES[month]} a ${MONTH_LONG_ES[endMonth]}`,
    years: endYear === year ? String(year) : `${year}-${String(endYear).slice(2)}`,
  };
}

/** Which lead to show (1 or 2): a meteorological season if one of the first two is, else the next three months. */
export function pickLead(lead1: string, lead2: string): 1 | 2 {
  if (seasonOf(lead1)?.name) return 1;
  if (seasonOf(lead2)?.name) return 2;
  return 1;
}

// ── where the odds lean ─────────────────────────────────────────────────────

/** Ray casting over every ring, so holes count as outside. */
function inRings(rings: number[][][], [x, y]: [number, number]): boolean {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
  return inside;
}

function contains(f: OutlookFeature, p: [number, number]): boolean {
  const g = f.geometry;
  if (!g) return false;
  return g.type === "Polygon" ? inRings(g.coordinates, p) : g.coordinates.some((poly) => inRings(poly, p));
}

/** The odds at a point: the most likely category (above, near or below normal) and its probability; null for equal chances. */
export function oddsAt(fc: OutlookCollection, p: [number, number]): { cat: Category; prob: number } | null {
  let best: { cat: Category; prob: number } | null = null;
  for (const f of fc.features) {
    const cat = f.properties.cat as Category;
    if (cat !== "Above" && cat !== "Below" && cat !== "Normal") continue;
    if (contains(f, p) && (!best || f.properties.prob > best.prob)) best = { cat, prob: f.properties.prob };
  }
  return best;
}

export interface Region {
  name: string;
  /** With its article, for sentences: "the Great Lakes", "California". */
  the: string;
  es: string;
  /** Cities across it, [lon, lat]. */
  points: [number, number][];
}

const R = (name: string, es: string, points: [number, number][], article = true): Region => ({ name, the: article ? `the ${name}` : name, es, points });

/** The US by region, each a handful of cities spread across it (the lower 48 and Alaska; CPC's outlooks cover those). */
export const REGIONS: Region[] = [
  R("Pacific Northwest", "el noroeste del Pacífico", [[-122.33, 47.61], [-122.68, 45.52], [-123.09, 44.05], [-117.43, 47.66], [-116.2, 43.62]]),
  R("California", "California", [[-121.49, 38.58], [-122.42, 37.77], [-119.79, 36.74], [-118.24, 34.05], [-117.16, 32.72]], false),
  R("Great Basin", "la Gran Cuenca", [[-119.81, 39.53], [-115.76, 40.83], [-111.89, 40.76], [-116.54, 38.2]]),
  R("Southwest", "el suroeste", [[-115.14, 36.17], [-112.07, 33.45], [-110.97, 32.22], [-106.65, 35.08], [-106.49, 31.76]]),
  R("Northern Rockies", "las Rocosas del norte", [[-113.99, 46.87], [-112.04, 46.59], [-108.5, 45.78], [-106.31, 42.87]]),
  R("Northern Plains", "las Llanuras del Norte", [[-100.78, 46.81], [-96.79, 46.88], [-103.23, 44.08], [-96.73, 43.55], [-95.94, 41.26]]),
  R("Central Plains", "las Llanuras Centrales", [[-104.99, 39.74], [-100.02, 37.75], [-97.34, 37.69], [-94.58, 39.1]]),
  R("Southern Plains", "las Llanuras del Sur", [[-97.52, 35.47], [-101.83, 35.22], [-96.8, 32.78], [-98.49, 29.42], [-95.37, 29.76]]),
  R("Upper Midwest", "el Alto Medio Oeste", [[-93.27, 44.98], [-92.1, 46.79], [-93.61, 41.59], [-89.4, 43.07]]),
  R("Great Lakes", "los Grandes Lagos", [[-87.63, 41.88], [-87.91, 43.04], [-85.67, 42.96], [-83.05, 42.33], [-81.69, 41.5], [-78.88, 42.89]]),
  R("Ohio Valley", "el valle del Ohio", [[-90.2, 38.63], [-86.16, 39.77], [-85.76, 38.25], [-84.51, 39.1], [-83.0, 39.96], [-86.78, 36.16]]),
  R("Southeast", "el sureste", [[-90.18, 32.3], [-86.8, 33.52], [-84.39, 33.75], [-80.84, 35.23], [-81.03, 34.0], [-90.07, 29.95]]),
  R("Florida", "Florida", [[-81.66, 30.33], [-84.28, 30.44], [-81.38, 28.54], [-82.46, 27.95], [-80.19, 25.76]], false),
  R("Mid-Atlantic", "el Atlántico Medio", [[-77.44, 37.54], [-77.04, 38.91], [-76.61, 39.29], [-75.17, 39.95], [-78.64, 35.78]]),
  R("Northeast", "el noreste", [[-74.01, 40.71], [-73.76, 42.65], [-71.06, 42.36], [-73.21, 44.48], [-70.26, 43.66]]),
  R("Alaska", "Alaska", [[-149.9, 61.22], [-147.72, 64.84], [-134.42, 58.3], [-165.41, 64.5], [-161.76, 60.79], [-156.79, 71.29]], false),
];

export interface Lean {
  region: Region;
  cat: Category;
  /** The lowest odds in the band it's in at its strongest point (CPC's 33, 40, 50, 60... contours). */
  prob: number;
}

/** Each region where at least half its cities lean the same way, with the highest odds among them. */
export function regionLeans(fc: OutlookCollection, regions = REGIONS): Lean[] {
  const out: Lean[] = [];
  for (const region of regions) {
    const odds = region.points.map((p) => oddsAt(fc, p));
    for (const cat of ["Above", "Below", "Normal"] as const) {
      const here = odds.filter((o) => o?.cat === cat);
      if (here.length * 2 >= region.points.length) {
        out.push({ region, cat, prob: Math.max(...here.map((o) => o!.prob)) });
        break;
      }
    }
  }
  return out;
}

export type Side = "north" | "south" | "west" | "east" | "south and east" | "south and west" | "north and east" | "north and west";

/**
 * Which part of the country these regions are in: "north", "south", "west" or "east" when (nearly) all of them
 * lie that way, or two sides ("south and east": NOAA's "southern tier and East Coast") when those cover nearly
 * all of them; null otherwise.
 */
export function sideOf(regions: Region[]): Side | null {
  if (regions.length < 3) return null;
  const centre = (r: Region) => [r.points.reduce((s, p) => s + p[0], 0) / r.points.length, r.points.reduce((s, p) => s + p[1], 0) / r.points.length] as const;
  const tests = { north: (r: Region) => centre(r)[1] >= 38.5, south: (r: Region) => centre(r)[1] <= 37.5, west: (r: Region) => centre(r)[0] <= -104, east: (r: Region) => centre(r)[0] >= -90 };
  const share = (...sides: (keyof typeof tests)[]) => regions.filter((r) => sides.some((s) => tests[s](r))).length / regions.length;
  for (const side of ["north", "south", "west", "east"] as const) if (share(side) >= 0.7) return side;
  for (const ns of ["south", "north"] as const) for (const we of ["east", "west"] as const) if (share(ns, we) >= 0.85) return `${ns} and ${we}`;
  return null;
}

const SIDE_ES: Record<Side, string> = {
  north: "el norte", south: "el sur", west: "el oeste", east: "el este",
  "south and east": "el sur y el este", "south and west": "el sur y el oeste", "north and east": "el norte y el este", "north and west": "el norte y el oeste",
};
/** "South and East" for titles. */
const sideTitle = (side: Side) => side.replace(/\b(north|south|east|west)\b/g, (w) => cap(w));
const WORD: Record<Variable, Record<"Above" | "Below", { en: string; es: string; adj: string }>> = {
  temp: { Above: { en: "Warmer", es: "Más cálido", adj: "warmer" }, Below: { en: "Colder", es: "Más frío", adj: "colder" } },
  prcp: { Above: { en: "Wetter", es: "Más húmedo", adj: "wetter" }, Below: { en: "Drier", es: "Más seco", adj: "drier" } },
};
const list = (xs: string[], and = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The strongest leans first, then west to east as listed. */
const strongest = (leans: Lean[]) => [...leans].sort((a, b) => b.prob - a.prob || REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region));
const inOrder = (leans: Lean[]) => [...leans].sort((a, b) => REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region));

/** "across the Pacific Northwest, the Great Lakes and the Northeast", or, for many, "across much of the north, led by ...". */
function whereEn(leans: Lean[]): string {
  if (leans.length <= 4) return `across ${list(inOrder(leans).map((l) => l.region.the))}`;
  const side = sideOf(leans.map((l) => l.region));
  const top = strongest(leans).slice(0, 3).map((l) => l.region.the);
  if (side) return `across much of the ${side}, including ${list(top)}`;
  return leans.length >= REGIONS.length * 0.6 ? `across most of the country, especially ${list(top)}` : `across ${top.join(", ")} and ${leans.length - 3} more regions`;
}
function whereEs(leans: Lean[]): string {
  if (leans.length <= 4) return `en ${list(inOrder(leans).map((l) => l.region.es), "y")}`;
  const side = sideOf(leans.map((l) => l.region));
  const top = strongest(leans).slice(0, 3).map((l) => l.region.es);
  if (side) return `en gran parte de ${SIDE_ES[side]}, incluidos ${list(top, "y")}`;
  return leans.length >= REGIONS.length * 0.6 ? `en la mayor parte del país, sobre todo ${list(top, "y")}` : `en ${top.join(", ")} y ${leans.length - 3} regiones más`;
}

export interface VariableSummary {
  /** Regions leaning above and below normal (near normal is rare and left to the map). */
  above: Lean[];
  below: Lean[];
  /** The two lines the narrator reads over this map. */
  lines: [string, string];
  /** The panel under the map: "Warmer: Pacific Northwest, Great Lakes, Northeast". */
  panel: string[];
  /** For the description. */
  sentence: string;
  sentenceEs: string;
  /** "Warmer North" for the title; null when it leans neither way enough. */
  headline: string | null;
  headlineEs: string | null;
}

export function summarize(variable: Variable, fc: OutlookCollection, season: Season): VariableSummary {
  const leans = regionLeans(fc);
  const above = leans.filter((l) => l.cat === "Above");
  const below = leans.filter((l) => l.cat === "Below");
  const noun = season.name ? season.name.toLowerCase() : "three months";
  const sentence = (cat: "Above" | "Below", ls: Lean[]) => `${WORD[variable][cat].en} than normal is favored ${whereEn(ls)}.`;
  const sentenceEs = (cat: "Above" | "Below", ls: Lean[]) => `${WORD[variable][cat].es} de lo normal ${whereEs(ls)}.`;
  const main = above.length >= below.length ? "Above" : "Below";
  const [first, second] = (main === "Above" ? [above, below] : [below, above]) as [Lean[], Lean[]];
  const other = main === "Above" ? "Below" : "Above";
  const top = strongest(leans.filter((l) => l.cat !== "Normal"))[0];
  const topLine = top ? `The odds are highest in ${top.region.the}: ${top.prob} percent or more for a ${WORD[variable][top.cat as "Above" | "Below"].adj} than normal ${noun}.` : "";
  const what = variable === "temp" ? "temperatures" : "rain and snow";
  const lines: [string, string] = !first.length
    ? [`For ${what}, no region leans clearly either way.`, "The odds of above, near or below normal are about equal."]
    : [sentence(main, first), second.length ? sentence(other, second) : topLine];
  const panelLine = (cat: "Above" | "Below", ls: Lean[]) => (ls.length ? `${WORD[variable][cat].en}: ${inOrder(ls).map((l) => l.region.name).join(", ")}` : null);
  const panel = [panelLine("Above", above), panelLine("Below", below)].filter((x): x is string => !!x);
  const side = first.length ? sideOf(first.map((l) => l.region)) : null;
  const lead = first.length >= 2 ? WORD[variable][main] : null;
  return {
    above,
    below,
    lines,
    panel: panel.length ? panel : ["Equal chances nearly everywhere"],
    sentence: [first.length ? sentence(main, first) : `For ${what}, no region leans clearly either way.`, second.length ? sentence(other, second) : ""].filter(Boolean).join(" "),
    sentenceEs: [
      first.length ? sentenceEs(main, first) : `Para ${variable === "temp" ? "las temperaturas" : "la lluvia y la nieve"}, ninguna región se inclina claramente.`,
      second.length ? sentenceEs(other, second) : "",
    ]
      .filter(Boolean)
      .join(" "),
    headline: lead ? `${lead.en} ${side ? sideTitle(side) : strongest(first)[0]!.region.name}` : null,
    headlineEs: lead ? `${lead.es} en ${side ? SIDE_ES[side] : strongest(first)[0]!.region.es}` : null,
  };
}

// ── the video ───────────────────────────────────────────────────────────────

const issuedEn = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(ms);
const issuedEs = (ms: number) => new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(ms);

export function seasonalText(season: Season, temp: VariableSummary, prcp: VariableSummary, issued: number) {
  const name = season.name ? `${season.name} Outlook` : "3-Month Outlook";
  const nameEs = season.nameEs ? `Pronóstico de ${season.nameEs}` : "Pronóstico de 3 meses";
  const heads = [temp.headline, prcp.headline].filter(Boolean).join(", ");
  const headsEs = [temp.headlineEs, prcp.headlineEs].filter(Boolean).join(", ");
  const span = season.name ? season.years : `${MONTH_EN[season.month]}–${MONTH_EN[(season.month + 2) % 12]} ${season.years}`;
  const spanEs = season.name ? season.years : `${MONTH_ES[season.month]}–${MONTH_ES[(season.month + 2) % 12]} ${season.years}`;
  return {
    title: fitTitle(
      heads ? `NOAA ${name} ${span}: ${heads} #shorts` : `NOAA ${name} ${span} #shorts`,
      heads ? `NOAA ${name}: ${heads} #shorts` : `NOAA ${name} #shorts`,
    ),
    description: [
      `NOAA's Climate Prediction Center ${season.name ? `${season.name.toLowerCase()} outlook` : "outlook"} for ${season.spoken} (${season.range}), issued ${issuedEn(issued)}: the odds of a warmer, colder, wetter or drier than normal ${season.name ? season.name.toLowerCase() : "three months"}.`,
      `Temperature: ${temp.sentence}`,
      `Precipitation: ${prcp.sentence}`,
      "These are odds, not amounts: colors show where one outcome is more likely than the usual one-in-three. Equal chances means no clear lean. The outlook isn't a snowfall forecast, and it's updated every month.",
      "Full outlook: https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.php",
      LINK_LINE,
      DISCLAIMER,
      `#weather #${season.name ? `${season.name.toLowerCase()}outlook` : "seasonaloutlook"} #noaa #forecast #shorts`,
    ].join("\n\n"),
    es: {
      title: fitTitle(headsEs ? `NOAA, ${nameEs.toLowerCase()} ${spanEs}: ${headsEs} #shorts` : `NOAA, ${nameEs.toLowerCase()} ${spanEs} #shorts`, `${nameEs} de la NOAA #shorts`),
      description: [
        `El pronóstico estacional del Centro de Predicción del Clima (CPC) de la NOAA para ${season.spokenEs} (${season.rangeEs}), publicado el ${issuedEs(issued)}: la probabilidad de que sea más cálido, más frío, más húmedo o más seco de lo normal.`,
        `Temperatura: ${temp.sentenceEs}`,
        `Precipitación: ${prcp.sentenceEs}`,
        "Son probabilidades, no cantidades: los colores muestran dónde un resultado es más probable que el habitual uno en tres. Probabilidades iguales significa que no hay una tendencia clara. No es un pronóstico de nieve, y se actualiza cada mes.",
        "Pronóstico completo (en inglés): https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.php",
        LINK_LINE_ES,
        DISCLAIMER_ES,
        "#clima #pronóstico #noaa #shorts",
      ].join("\n\n"),
    },
  };
}

/** Twice the ring's area in lon/lat, positive when it runs counterclockwise. */
const signedArea = (ring: number[][]) => ring.reduce((sum, [x, y], i) => sum + x! * ring[(i + 1) % ring.length]![1]! - ring[(i + 1) % ring.length]![0]! * y!, 0);
/**
 * d3-geo takes a polygon's outer ring clockwise and its holes counterclockwise (on the sphere,
 * either way round is a valid polygon, so the other order is the whole globe but this shape),
 * while GeoJSON from the map service runs the other way.
 */
export function rewind(rings: number[][][]): number[][][] {
  return rings.map((ring, i) => ((i === 0) === signedArea(ring) > 0 ? [...ring].reverse() : ring));
}

/** Only what the map draws, highest odds last so they're on top, wound the way d3 draws them. */
export const drawn = (fc: OutlookCollection) => ({
  type: "FeatureCollection",
  features: fc.features
    .filter((f) => f.geometry && ["Above", "Below", "Normal"].includes(f.properties.cat))
    .sort((a, b) => a.properties.prob - b.properties.prob)
    .map((f) => {
      const g = f.geometry!;
      const geometry = g.type === "Polygon" ? { type: g.type, coordinates: rewind(g.coordinates) } : { type: g.type, coordinates: g.coordinates.map(rewind) };
      return { type: "Feature", geometry, properties: { cat: f.properties.cat, prob: f.properties.prob } };
    }),
});

const query = (svc: string, lead: number, geometry: boolean) =>
  `${SERVICES}/${svc}/MapServer/${lead - 1}/query?where=1%3D1&outFields=cat,prob,valid_seas,fcst_date&returnGeometry=${geometry}${geometry ? SIMPLIFY : ""}&f=geojson`;

const first = (fc: OutlookCollection) => fc.features.find((f) => f.properties.valid_seas)?.properties;

export const seasonalKind: Kind = async (ctx: KindContext): Promise<Video[]> => {
  const [l1, l2] = await Promise.all([1, 2].map((lead) => getJson<OutlookCollection>(ctx, `seasonal-lead${lead}.json`, query("cpc_sea_temp_outlk", lead, false))));
  const lead = pickLead(first(l1!)?.valid_seas ?? "", first(l2!)?.valid_seas ?? "");
  const [temp, prcp] = await Promise.all([
    getJson<OutlookCollection>(ctx, "seasonal-temp.json", query("cpc_sea_temp_outlk", lead, true)),
    getJson<OutlookCollection>(ctx, "seasonal-prcp.json", query("cpc_sea_precip_outlk", lead, true)),
  ]);
  const props = first(temp);
  const season = seasonOf(props?.valid_seas ?? "");
  const issued = Number(props?.fcst_date);
  if (!season || !Number.isFinite(issued)) throw new Error(`The seasonal outlook has no season or issue date (${props?.valid_seas}, ${props?.fcst_date}).`);
  console.log(`Seasonal outlook: lead ${lead}, ${season.code} ${season.year}, issued ${new Date(issued).toISOString().slice(0, 10)}.`);
  // Scheduled runs go every Thursday; only the third Thursday's update is new.
  if (ctx.env.SHORTS_LATEST !== "1" && !ctx.fixtures && Date.now() - issued > FRESH_MS) {
    console.log("No new seasonal outlook this week.");
    return [];
  }
  const t = summarize("temp", temp, season);
  const p = summarize("prcp", prcp, season);
  for (const [k, s] of [["Temperature", t], ["Precipitation", p]] as const) console.log(`${k}: ${s.sentence}`);
  return [
    {
      key: "seasonal",
      template: "seasonal.html",
      ...seasonalText(season, t, p, issued),
      tags: ["seasonal outlook", ...(season.name ? [`${season.name.toLowerCase()} outlook`, `${season.name.toLowerCase()} forecast`] : []), "NOAA", "Climate Prediction Center", "weather forecast", "Storm Central"],
      playlist: "Seasonal Outlooks",
      data: {
        states: readVendor("states-10m.json"),
        season: { name: season.name, range: season.range, spoken: season.spoken, years: season.years },
        issued: issuedEn(issued),
        temp: { features: drawn(temp), panel: t.panel, lines: t.lines },
        prcp: { features: drawn(prcp), panel: p.panel, lines: p.lines },
      },
    },
  ];
};
