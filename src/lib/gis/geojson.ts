/**
 * GeoJSON layers, styled with the common "simplestyle" properties when they
 * have them (stroke, stroke-width, stroke-opacity, fill, fill-opacity,
 * marker-color, title / name for the label and description for details).
 */
import type { Feature, Geometry, Position } from "geojson";
import { type GisData, type GisFeature } from "./types";

const DEFAULT_COLOR = "#ffcc00";
const MAX_FEATURES = 20_000;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const colorOf = (v: unknown) => (typeof v === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : undefined);
const numberOf = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);

function features(json: unknown): Feature[] {
  if (!json || typeof json !== "object") return [];
  const o = json as { type?: string; features?: unknown[]; geometry?: unknown; geometries?: unknown[] };
  if (o.type === "FeatureCollection" && Array.isArray(o.features)) return o.features.filter((f): f is Feature => !!f && typeof f === "object" && (f as Feature).type === "Feature");
  if (o.type === "Feature") return [json as Feature];
  if (typeof o.type === "string") return [{ type: "Feature", geometry: json as Geometry, properties: {} }];
  return [];
}

/** Hover text from the feature's own properties: its name and description, or failing those every simple value. */
function hoverOf(p: Record<string, unknown>): string | undefined {
  const title = str(p.title) ?? str(p.name) ?? str(p.NAME);
  const desc = str(p.description);
  if (title || desc) return [title, desc].filter(Boolean).join("\n");
  const lines = Object.entries(p)
    .filter(([k, v]) => !/^(stroke|fill|marker)/.test(k) && (typeof v === "string" || typeof v === "number") && String(v).length < 120)
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${v}`);
  return lines.length ? lines.join("\n") : undefined;
}

export function parseGeoJson(text: string): GisData {
  const json: unknown = JSON.parse(text);
  const out: GisFeature[] = [];
  const add = (geometry: Geometry, props: GisFeature["properties"]) => {
    if (out.length < MAX_FEATURES) out.push({ type: "Feature", geometry, properties: props });
  };
  for (const f of features(json)) {
    const g = f.geometry;
    if (!g) continue;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const hover = hoverOf(p);
    const stroke = colorOf(p.stroke) ?? DEFAULT_COLOR;
    const line = { color: stroke, opacity: numberOf(p["stroke-opacity"], 0, 1) ?? 1, width: numberOf(p["stroke-width"], 0.5, 20) ?? 2 };
    const fill = { color: colorOf(p.fill) ?? stroke, opacity: numberOf(p["fill-opacity"], 0, 1) ?? 0.3 };
    const label = str(p.title) ?? str(p.name);
    const each = (geom: Geometry) => {
      switch (geom.type) {
        case "Point":
        case "MultiPoint":
          add(geom, { kind: "point", color: colorOf(p["marker-color"]) ?? stroke, hover, minzoom: 0 });
          if (label) add(geom, { kind: "text", text: label, color: "#ffffff", size: 11, dx: 0, dy: -14, hover, minzoom: 0 });
          break;
        case "LineString":
        case "MultiLineString":
          add(geom, { kind: "line", ...line, hover, minzoom: 0 });
          break;
        case "Polygon":
        case "MultiPolygon": {
          add(geom, { kind: "fill", ...fill, hover, minzoom: 0 });
          const rings: Position[][] = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
          add({ type: "MultiLineString", coordinates: rings }, { kind: "line", ...line, hover, minzoom: 0 });
          break;
        }
        case "GeometryCollection":
          geom.geometries.forEach(each);
          break;
      }
    };
    each(g);
  }
  const name = json && typeof json === "object" ? str((json as { name?: unknown }).name) : undefined;
  return { title: name ?? null, refreshSec: null, iconFiles: [], features: out };
}
