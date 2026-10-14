/**
 * Hurricane and tropical storm updates: once a day, a Short for each named
 * storm (up to SHORTS_TROPICAL_MAX, default 2, strongest first) with the
 * National Hurricane Center's cone, track and forecast. Loads them like the
 * app's tropical feed (src/lib/feeds/tropical.ts), with the same parsers, but
 * without its server plumbing (which would pull the app's packages into the
 * bundle).
 */
import type { TropicalStorm } from "../../src/lib/feeds/tropical";
import {
  lineThrough,
  mergeLines,
  mergePolygons,
  parseCurrentStorms,
  parseForecastPoints,
  parseLayerMap,
  stormFeatures,
  stormTitle,
  type TropicalLayerKind,
} from "../../src/lib/feeds/tropical-parse";
import { translator } from "../../src/lib/i18n/core";
import { DISCLAIMER, DISCLAIMER_ES, fitTitle, LINK_LINE, LINK_LINE_ES, shortDayEn, shortDayEs } from "../meta";
import { getJson, readVendor } from "../source";
import type { Kind, KindContext } from "../video";

/** Named storms only: hurricanes, tropical and subtropical storms. */
const NAMED = new Set(["HU", "TS", "STS", "SS", "TY", "STY"]);

export const toMph = (kt: number) => Math.round((kt * 1.15078) / 5) * 5;
export const toKmh = (kt: number) => Math.round((kt * 1.852) / 5) * 5;
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
const COMPASS_ES: Record<string, string> = { N: "N", NNE: "NNE", NE: "NE", ENE: "ENE", E: "E", ESE: "ESE", SE: "SE", SSE: "SSE", S: "S", SSW: "SSO", SW: "SO", WSW: "OSO", W: "O", WNW: "ONO", NW: "NO", NNW: "NNO" };

const STAGE_EN: Record<string, string> = { TS: "Tropical storm", TD: "Tropical depression", SS: "Subtropical storm", SD: "Subtropical depression", PT: "Post-tropical", LO: "Remnant low", DB: "Disturbance", PC: "Potential cyclone" };
const STAGE_ES: Record<string, string> = { TS: "Tormenta tropical", TD: "Depresión tropical", SS: "Tormenta subtropical", SD: "Depresión subtropical", PT: "Postropical", LO: "Baja remanente", DB: "Perturbación", PC: "Ciclón potencial" };
/** NHC's point labels ("H2", "TS", "PT") in words. */
export function stageName(label: string | null | undefined, lang: "en" | "es" = "en"): string {
  if (!label) return "";
  const h = /^H([1-5])$/.exec(label);
  if (h) return lang === "es" ? `Huracán categoría ${h[1]}` : `Category ${h[1]} hurricane`;
  return (lang === "es" ? STAGE_ES : STAGE_EN)[label] ?? label;
}

/** The storm's local clock: Eastern for the Atlantic, Pacific for the eastern Pacific, Hawaii for the central Pacific. */
export const zoneOf = (s: Pick<TropicalStorm, "basin">) =>
  s.basin === "Eastern Pacific" ? "America/Los_Angeles" : s.basin === "Central Pacific" ? "Pacific/Honolulu" : "America/New_York";

/** Named storms, strongest first, at most `max`. */
export function pickStorms(storms: TropicalStorm[], max = 2): TropicalStorm[] {
  return storms
    .filter((s) => NAMED.has(s.classification.toUpperCase()) && s.windKt != null)
    .sort((a, b) => (b.windKt ?? 0) - (a.windKt ?? 0))
    .slice(0, max);
}

const latlon = (lat: number, lon: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
const when = (iso: string | null, zone: string, locale = "en-US") =>
  iso ? new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short", hour: "numeric" }).format(Date.parse(iso)) : "";
const issuedAt = (s: TropicalStorm, locale = "en-US") => {
  const iso = s.advisory?.issued ?? s.updated;
  return iso ? new Intl.DateTimeFormat(locale, { timeZone: zoneOf(s), weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(Date.parse(iso)) : "";
};

/** The next forecast points (not the advisory position), up to `n`. */
export const upcoming = (s: TropicalStorm, n = 4) => s.forecast.filter((p) => p.tau !== 0 && p.time && Date.parse(p.time) > Date.parse(s.advisory?.issued ?? s.updated ?? "1970")).slice(0, n);

const catOf = (label: string | null | undefined) => Number(/^H([1-5])$/.exec(label ?? "")?.[1] ?? 0);

/** Strengthening ahead: the highest category in the forecast when above today's (0 = not a hurricane). */
export function peakAhead(s: TropicalStorm): number | null {
  const peak = Math.max(0, ...upcoming(s, 10).map((p) => catOf(p.label)));
  return peak > (s.category ?? catOf(s.label)) ? peak : null;
}

const peakText = (s: TropicalStorm, lang: "en" | "es" = "en") => {
  const peak = peakAhead(s);
  if (!peak) return null;
  if (lang === "es") return s.category ? `se pronostica que alcance la categoría ${peak}` : "se pronostica que se convierta en huracán";
  return s.category ? `Forecast to Reach Category ${peak}` : "Forecast to Become a Hurricane";
};

export function tropicalText(s: TropicalStorm, now: number) {
  const zone = zoneOf(s);
  const wind = s.windKt ?? 0;
  const cat = s.category;
  const titleEs = stormTitle(s.classification, s.name, translator("es"));
  const strength = cat ? `Category ${cat}, ${toMph(wind)} mph` : `${toMph(wind)} mph Winds`;
  const strengthEs = cat ? `categoría ${cat}, ${toKmh(wind)} km/h` : `vientos de ${toKmh(wind)} km/h`;
  const moving = s.movement.towardDeg != null && s.movement.speedMph != null ? `moving ${compass(s.movement.towardDeg)} at ${Math.round(s.movement.speedMph)} mph` : null;
  const movingEs =
    s.movement.towardDeg != null && s.movement.speedMph != null
      ? `se mueve hacia el ${COMPASS_ES[compass(s.movement.towardDeg)]} a ${Math.round(s.movement.speedMph * 1.609)} km/h`
      : null;
  const next = upcoming(s);
  const forecast = next.map((p) => `${when(p.time, zone)}: ${stageName(p.label)}${p.windKt ? `, ${toMph(p.windKt)} mph` : ""}`).join(" · ");
  const forecastEs = next.map((p) => `${when(p.time, zone, "es-MX")}: ${stageName(p.label, "es")}${p.windKt ? `, ${toKmh(p.windKt)} km/h` : ""}`).join(" · ");
  const ahead = peakText(s);
  const aheadEs = peakText(s, "es");
  const adv = s.advisory?.number ? `advisory ${s.advisory.number}, ` : "";
  const advEs = s.advisory?.number ? `aviso ${s.advisory.number}, ` : "";
  return {
    title: fitTitle(
      ...(ahead ? [`${s.title} Update, ${shortDayEn(now, zone)}: ${strength}, ${ahead} #shorts`, `${s.title}: ${strength}, ${ahead} #shorts`] : []),
      `${s.title} Update, ${shortDayEn(now, zone)}: ${strength} #shorts`,
      `${s.title}: ${strength} #shorts`,
    ),
    description: [
      `${s.title}: the latest from the National Hurricane Center (${adv}${issuedAt(s)}).`,
      [
        `Maximum sustained winds ${toMph(wind)} mph${cat ? ` (Category ${cat})` : ""}${s.pressureMb ? `, minimum pressure ${s.pressureMb} mb` : ""}.`,
        `Located at ${latlon(s.lat, s.lon)}${moving ? `, ${moving}` : ""}.`,
        ahead ? (s.category ? `It is forecast to reach Category ${peakAhead(s)}.` : "It is forecast to become a hurricane.") : "",
      ]
        .filter(Boolean)
        .join(" "),
      forecast ? `Forecast: ${forecast}` : null,
      s.advisoryUrl ? `Full advisory: ${s.advisoryUrl}` : null,
      LINK_LINE,
      `${DISCLAIMER} For official hurricane forecasts, see nhc.noaa.gov.`,
      "#hurricane #tropics #weather #shorts",
    ]
      .filter(Boolean)
      .join("\n\n"),
    es: {
      title: fitTitle(
        ...(aheadEs ? [`${titleEs}: ${strengthEs}; ${aheadEs} #shorts`] : []),
        `${titleEs}, actualización ${shortDayEs(now, zone)}: ${strengthEs} #shorts`,
        `${titleEs}: ${strengthEs} #shorts`,
      ),
      description: [
        `${titleEs}: lo último del Centro Nacional de Huracanes (${advEs}${issuedAt(s, "es-MX")}).`,
        [
          `Vientos máximos sostenidos de ${toKmh(wind)} km/h (${toMph(wind)} mph)${cat ? `, categoría ${cat}` : ""}${s.pressureMb ? `, presión mínima de ${s.pressureMb} mb` : ""}.`,
          `Ubicado en ${latlon(s.lat, s.lon)}${movingEs ? `; ${movingEs}` : ""}.`,
          aheadEs ? `${aheadEs.charAt(0).toUpperCase()}${aheadEs.slice(1)}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        forecastEs ? `Pronóstico: ${forecastEs}` : null,
        s.advisoryUrl ? `Aviso completo (en inglés): ${s.advisoryUrl}` : null,
        LINK_LINE_ES,
        `${DISCLAIMER_ES} Para los pronósticos oficiales de huracanes, consulta nhc.noaa.gov.`,
        "#huracán #trópicos #clima #shorts",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  };
}

const STORMS_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";
const MAPSERVER = "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer";

/** NHC's active storms with cone, track, forecast points and past track (each null or empty when missing). */
async function loadStorms(ctx: KindContext): Promise<TropicalStorm[]> {
  const storms = parseCurrentStorms(await getJson<unknown>(ctx, "nhc-storms.json", STORMS_URL));
  if (!storms) throw new Error("Unrecognised NHC storm list");
  if (!storms.length) return storms;
  const layers = parseLayerMap(await getJson<unknown>(ctx, "nhc-layers.json", `${MAPSERVER}?f=json`).catch(() => null));
  const layer = (id: number | undefined) =>
    id == null
      ? Promise.resolve(null)
      : getJson<unknown>(ctx, `nhc-layer-${id}.json`, `${MAPSERVER}/${id}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`).catch(() => null);
  return Promise.all(
    storms.map(async (storm) => {
      const ids: Partial<Record<TropicalLayerKind, number>> | undefined = storm.bin ? layers[storm.bin] : undefined;
      if (!ids) return storm;
      const [cone, track, points, past] = await Promise.all([layer(ids.cone), layer(ids.forecastTrack), layer(ids.forecastPoints), layer(ids.pastTrack ?? ids.pastPoints)]);
      const forecast = parseForecastPoints(stormFeatures(points, storm), storm.advisory?.issued ?? storm.updated);
      return {
        ...storm,
        cone: mergePolygons(stormFeatures(cone, storm)),
        track: mergeLines(stormFeatures(track, storm)) ?? lineThrough(forecast),
        forecast,
        pastTrack: mergeLines(stormFeatures(past, storm)),
      };
    }),
  );
}

export const tropicalKind: Kind = async (ctx) => {
  const now = Date.now();
  const all = await loadStorms(ctx);
  const storms = pickStorms(all, Math.max(1, Number(ctx.env.SHORTS_TROPICAL_MAX) || 2));
  console.log(`Tropics: ${all.map((s) => `${s.title} (${s.windKt ?? "?"} kt)`).join(", ") || "no active storms"}; ${storms.length} to post.`);
  const world = storms.length ? readVendor("countries-50m.json") : null;
  const states = storms.length ? readVendor("states-10m.json") : null;
  return storms.map((s) => {
    const zone = zoneOf(s);
    return {
      key: `tropical-${s.id}`,
      template: "tropical.html",
      ...tropicalText(s, now),
      tags: ["hurricane", "tropical storm", s.name, s.title, "National Hurricane Center", "tropics", "Storm Central"],
      playlist: "Tropical Updates",
      data: {
        world,
        states,
        storm: {
          title: s.title,
          basin: s.basin ?? "Atlantic",
          classification: s.classification,
          category: s.category,
          label: s.label ?? null,
          stage: stageName(s.label) || s.title.replace(` ${s.name}`, ""),
          ahead: peakAhead(s) ? (s.category ? `Forecast to reach Category ${peakAhead(s)}` : "Forecast to become a hurricane") : null,
          windMph: s.windKt != null ? toMph(s.windKt) : null,
          pressureMb: s.pressureMb,
          moving: s.movement.towardDeg != null && s.movement.speedMph != null ? `${compass(s.movement.towardDeg)} at ${Math.round(s.movement.speedMph)} mph` : null,
          lat: s.lat,
          lon: s.lon,
          advisory: [s.advisory?.number ? `Advisory ${s.advisory.number}` : null, issuedAt(s)].filter(Boolean).join(" · "),
          cone: s.cone,
          track: s.track,
          past: s.pastTrack,
          forecast: upcoming(s, 5).map((p) => ({ lat: p.lat, lon: p.lon, label: p.label, stage: stageName(p.label), windMph: p.windKt != null ? toMph(p.windKt) : null, when: when(p.time, zone) })),
        },
      },
    };
  });
};
