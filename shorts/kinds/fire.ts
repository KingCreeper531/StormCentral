/**
 * Wildfire updates: once a day, a Short for the most significant active US
 * wildfire (up to SHORTS_FIRE_MAX, default 1) from the National Interagency
 * Fire Center's WFIGS incidents, with its mapped perimeter and how much it grew
 * since the day before. The day-before sizes come from the previous run's
 * snapshot (SHORTS_STATE_DIR/fire-sizes.json, kept in the Actions cache).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DISCLAIMER_ES, fitTitle, LINK_LINE, LINK_LINE_ES } from "../meta";
import { STATE_NAMES } from "../narration";
import { getJson, readVendor } from "../source";
import type { Kind, KindContext } from "../video";

const WFIGS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services";
/** A fire worth a Short: big enough and far from contained, or growing fast. */
const MIN_ACRES = 5_000;
const MAX_CONTAINED = 80;
const FAST_GROWTH = 1_000;

export interface Fire {
  id: string;
  name: string;
  acres: number;
  contained: number | null;
  /** Two-letter state, e.g. "WA". */
  state: string;
  county: string | null;
  lat: number;
  lon: number;
  discovered: number | null;
  personnel: number | null;
}

/** "THREE QUEENS" → "Three Queens Fire"; "Bench" → "Bench Fire"; "X Complex" stays. */
export function fireName(raw: string): string {
  const name = (raw === raw.toUpperCase() ? raw.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : raw).trim();
  return /\b(fire|complex)$/i.test(name) ? name : `${name} Fire`;
}

interface RawIncident {
  attributes?: Record<string, unknown>;
  geometry?: { x?: number; y?: number };
}

/** Active wildfires (not prescribed burns, not fully contained), largest first. */
export function parseFires(raw: unknown): Fire[] {
  const features = (raw as { features?: RawIncident[] })?.features ?? [];
  const out: Fire[] = [];
  for (const f of features) {
    const a = f.attributes ?? {};
    const num = (k: string) => (typeof a[k] === "number" ? (a[k] as number) : null);
    const str = (k: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : null);
    const lon = f.geometry?.x, lat = f.geometry?.y, acres = num("IncidentSize"), id = str("IrwinID") ?? str("UniqueFireIdentifier");
    if (typeof lon !== "number" || typeof lat !== "number" || acres == null || !id || !str("IncidentName")) continue;
    if (a.IncidentTypeCategory !== "WF" && a.IncidentTypeCategory !== "CX") continue;
    const contained = num("PercentContained");
    if (contained != null && contained >= 100) continue;
    out.push({
      id,
      name: fireName(str("IncidentName")!),
      acres: Math.round(acres),
      contained: contained == null ? null : Math.round(contained),
      state: (str("POOState") ?? "").replace(/^US-/, ""),
      county: str("POOCounty"),
      lat,
      lon,
      discovered: num("FireDiscoveryDateTime"),
      personnel: num("TotalIncidentPersonnel"),
    });
  }
  return out.sort((x, y) => y.acres - x.acres);
}

export interface Snapshot {
  at: number;
  sizes: Record<string, number>;
}

/** Acres added since the snapshot, when it's 12–36 hours old (so "since yesterday" is true). */
export function growthSince(f: Fire, prev: Snapshot | null, now: number): number | null {
  if (!prev || now - prev.at < 12 * 3_600_000 || now - prev.at > 36 * 3_600_000) return null;
  const before = prev.sizes[f.id];
  return before == null ? null : Math.max(0, f.acres - before);
}

/** The fires worth a Short today: growing fast, or big and mostly uncontained; fastest-growing then largest first. */
export function pickFires(fires: Fire[], prev: Snapshot | null, now: number, max = 1): { fire: Fire; growth: number | null }[] {
  return fires
    .map((fire) => ({ fire, growth: growthSince(fire, prev, now) }))
    .filter(({ fire, growth }) => (growth ?? 0) >= FAST_GROWTH || (fire.acres >= MIN_ACRES && (fire.contained ?? 0) <= MAX_CONTAINED))
    .sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0) || b.fire.acres - a.fire.acres)
    .slice(0, max);
}

const n = (v: number) => v.toLocaleString("en-US");
const nEs = (v: number) => v.toLocaleString("es-MX");
const hectares = (acres: number) => Math.round(acres * 0.404686);
const stateName = (s: string) => STATE_NAMES[s] ?? s;
const days = (from: number, now: number) => Math.max(0, Math.floor((now - from) / 86_400_000));
const dayEn = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric" }).format(ms);
const dayEs = (ms: number) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Denver", month: "short", day: "numeric" }).format(ms);
const placeOf = (f: Fire) => [f.county ? `${f.county} County` : null, stateName(f.state)].filter(Boolean).join(", ");

export function fireText(f: Fire, growth: number | null, now: number) {
  const state = stateName(f.state);
  const contained = f.contained == null ? null : `${f.contained}% Contained`;
  const grew = growth ? `Grew ${n(growth)} Acres` : null;
  const started = f.discovered != null ? `It started on ${dayEn(f.discovered)} (${days(f.discovered, now)} days ago).` : "";
  const startedEs = f.discovered != null ? `Comenzó el ${dayEs(f.discovered)} (hace ${days(f.discovered, now)} días).` : "";
  return {
    title: fitTitle(
      `${f.name}, ${state}: ${n(f.acres)} Acres${contained ? `, ${contained}` : ""}${grew ? `; ${grew}` : ""} #shorts`,
      `${f.name}, ${state}: ${n(f.acres)} Acres${contained ? `, ${contained}` : ""} #shorts`,
      `${f.name}: ${n(f.acres)} Acres #shorts`,
    ),
    description: [
      `The ${f.name} in ${placeOf(f)} has burned ${n(f.acres)} acres${f.contained != null ? ` and is ${f.contained}% contained` : ""}, according to the National Interagency Fire Center. ${started}`.trim(),
      [growth ? `It grew by ${n(growth)} acres since yesterday.` : "", f.personnel ? `${n(f.personnel)} personnel are assigned to it.` : ""].filter(Boolean).join(" ") || null,
      "Fire sizes and containment are the latest reported to NIFC and can lag what's happening on the ground.",
      LINK_LINE,
      "Storm Central is not an official warning system. Follow evacuation orders from local officials and the incident's official updates.",
      "#wildfire #fire #weather #shorts",
    ]
      .filter(Boolean)
      .join("\n\n"),
    es: {
      title: fitTitle(
        `Incendio ${f.name.replace(/ Fire$/, "")}, ${state}: ${nEs(hectares(f.acres))} hectáreas${f.contained != null ? `, ${f.contained}% contenido` : ""} #shorts`,
        `Incendio ${f.name.replace(/ Fire$/, "")}: ${nEs(hectares(f.acres))} hectáreas #shorts`,
      ),
      description: [
        `El incendio ${f.name.replace(/ Fire$/, "")} en ${placeOf(f)} ha quemado ${nEs(f.acres)} acres (${nEs(hectares(f.acres))} hectáreas)${f.contained != null ? ` y está ${f.contained}% contenido` : ""}, según el Centro Nacional Interinstitucional de Incendios (NIFC). ${startedEs}`.trim(),
        [growth ? `Creció ${nEs(growth)} acres desde ayer.` : "", f.personnel ? `${nEs(f.personnel)} personas trabajan en él.` : ""].filter(Boolean).join(" ") || null,
        LINK_LINE_ES,
        `${DISCLAIMER_ES} Sigue las órdenes de evacuación de las autoridades locales.`,
        "#incendio #incendioforestal #clima #shorts",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  };
}

function readSnapshot(dir: string): Snapshot | null {
  const file = join(dir, "fire-sizes.json");
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Snapshot) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(dir: string, fires: Fire[], now: number) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fire-sizes.json"), JSON.stringify({ at: now, sizes: Object.fromEntries(fires.map((f) => [f.id, f.acres])) } satisfies Snapshot));
}

async function perimeter(ctx: KindContext, f: Fire): Promise<unknown[]> {
  const where = `poly_IRWINID = '${f.id.replace(/'/g, "")}'`;
  const url = `${WFIGS}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=${encodeURIComponent(where)}&outFields=poly_IncidentName&geometryPrecision=4&maxAllowableOffset=0.001&outSR=4326&f=geojson`;
  const fc = await getJson<{ features?: { properties?: Record<string, unknown> }[] }>(ctx, `fire-perimeter-${f.id.replace(/[^\w-]/g, "")}.json`, url).catch(() => null);
  return fc?.features ?? [];
}

export const fireKind: Kind = async (ctx) => {
  const now = Date.now();
  const where = "IncidentTypeCategory IN ('WF','CX') AND (PercentContained IS NULL OR PercentContained < 100) AND IncidentSize >= 100";
  const fields = "IrwinID,UniqueFireIdentifier,IncidentName,IncidentSize,PercentContained,POOState,POOCounty,FireDiscoveryDateTime,TotalIncidentPersonnel,IncidentTypeCategory";
  const raw = await getJson<unknown>(
    ctx,
    "fire-incidents.json",
    `${WFIGS}/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=${encodeURIComponent(where)}&outFields=${fields}&returnGeometry=true&outSR=4326&orderByFields=IncidentSize%20DESC&resultRecordCount=200&f=json`,
  );
  const fires = parseFires(raw);
  const dir = ctx.env.SHORTS_STATE_DIR || "shorts/.state";
  const prev = readSnapshot(dir);
  const picked = pickFires(fires, prev, now, Math.max(1, Number(ctx.env.SHORTS_FIRE_MAX) || 1));
  console.log(`Wildfires: ${fires.length} active over 100 acres; ${picked.map((p) => `${p.fire.name} (${p.fire.acres} ac, ${p.fire.contained ?? "?"}%${p.growth != null ? `, +${p.growth}` : ""})`).join(", ") || "none to post"}.`);
  if (!ctx.fixtures) writeSnapshot(dir, fires, now);
  const big = fires.filter((f) => f.acres >= 1_000);
  return Promise.all(
    picked.map(async ({ fire: f, growth }) => ({
      key: `fire-${f.id.replace(/[^\w-]/g, "").slice(0, 12)}`,
      template: "fire.html",
      ...fireText(f, growth, now),
      tags: ["wildfire", "fire", f.name, stateName(f.state), "NIFC", "Storm Central"],
      playlist: "Wildfire Updates",
      data: {
        states: readVendor("states-10m.json"),
        fire: {
          name: f.name,
          place: placeOf(f),
          state: stateName(f.state),
          acres: f.acres,
          contained: f.contained,
          growth,
          personnel: f.personnel,
          started: f.discovered != null ? dayEn(f.discovered) : null,
          days: f.discovered != null ? days(f.discovered, now) : null,
          lat: f.lat,
          lon: f.lon,
          perimeter: await perimeter(ctx, f),
        },
        others: big.map((o) => ({ lat: o.lat, lon: o.lon, acres: o.acres, me: o.id === f.id })),
        count: big.length,
      },
    })),
  );
};
