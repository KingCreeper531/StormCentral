/**
 * KML (Google Earth, My Maps, many agencies' downloads): placemarks with
 * points, lines and polygons (also inside MultiGeometry), their names and
 * descriptions, and line / fill colours from <Style>, <StyleMap> and inline
 * styles. Read with plain string scanning so it runs anywhere (no DOM).
 * KMZ (zipped KML), network links and overlays aren't supported.
 */
import { hex, type GisData, type GisFeature } from "./types";

const DEFAULT_COLOR = "#ffcc00";

/** The inner text of the first <tag> (namespace prefixes allowed), or null. */
function inner(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i").exec(xml);
  return m ? m[1]! : null;
}
function all(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi");
  return [...xml.matchAll(re)].map((m) => m[1]!);
}
const attr = (open: string, name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(open)?.[1] ?? null;

/** Text with CDATA, tags and entities removed. */
export function plainText(s: string | null): string | undefined {
  if (!s) return undefined;
  const out = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return out || undefined;
}

/** KML colours are aabbggrr. */
export function kmlColor(s: string | null): { color: string; opacity: number } | null {
  const m = s ? /^\s*#?([0-9a-f]{8})\s*$/i.exec(s) : null;
  if (!m) return null;
  const v = m[1]!;
  const p = (i: number) => parseInt(v.slice(i, i + 2), 16);
  return { color: hex(p(6), p(4), p(2)), opacity: p(0) / 255 };
}

interface Style {
  line?: { color: string; opacity: number; width: number };
  fill?: { color: string; opacity: number } | null;
  icon?: { color: string } | null;
}

function parseStyle(xml: string): Style {
  const st: Style = {};
  const ls = inner(xml, "LineStyle");
  if (ls) {
    const c = kmlColor(inner(ls, "color"));
    st.line = { color: c?.color ?? DEFAULT_COLOR, opacity: c?.opacity ?? 1, width: Number(inner(ls, "width")) || 2 };
  }
  const ps = inner(xml, "PolyStyle");
  if (ps) {
    const c = kmlColor(inner(ps, "color"));
    st.fill = inner(ps, "fill")?.trim() === "0" ? null : { color: c?.color ?? DEFAULT_COLOR, opacity: c?.opacity ?? 0.35 };
  }
  const is = inner(xml, "IconStyle");
  if (is) {
    const c = kmlColor(inner(is, "color"));
    st.icon = c ? { color: c.color } : null;
  }
  return st;
}

/** "lon,lat[,alt] lon,lat …" → [[lon, lat], …]. */
function coords(s: string | null): [number, number][] {
  if (!s) return [];
  const out: [number, number][] = [];
  for (const tuple of s.trim().split(/\s+/)) {
    const [lon, lat] = tuple.split(",").map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat!) <= 90 && Math.abs(lon!) <= 180) out.push([lon!, lat!]);
  }
  return out;
}

export function parseKml(xml: string): GisData {
  const styles = new Map<string, Style>();
  for (const m of xml.matchAll(/<(?:\w+:)?Style\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Style>/gi)) {
    const id = attr(m[1]!, "id");
    if (id) styles.set(id, parseStyle(m[2]!));
  }
  // StyleMap: use its "normal" style.
  for (const m of xml.matchAll(/<(?:\w+:)?StyleMap\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?StyleMap>/gi)) {
    const id = attr(m[1]!, "id");
    const normal = all(m[2]!, "Pair").find((p) => inner(p, "key")?.trim() === "normal");
    const ref = normal ? inner(normal, "styleUrl")?.trim().replace(/^.*#/, "") : null;
    if (id && ref && styles.has(ref)) styles.set(id, styles.get(ref)!);
  }

  const features: GisFeature[] = [];
  for (const pm of all(xml, "Placemark")) {
    const name = plainText(inner(pm, "name"));
    const desc = plainText(inner(pm, "description"));
    const hover = [name, desc].filter(Boolean).join("\n") || undefined;
    const ref = inner(pm, "styleUrl")?.trim().replace(/^.*#/, "");
    const inline = inner(pm, "Style");
    const st: Style = { ...(ref ? styles.get(ref) : undefined), ...(inline ? parseStyle(inline) : {}) };
    const line = st.line ?? { color: DEFAULT_COLOR, opacity: 1, width: 2 };

    for (const p of all(pm, "Point")) {
      const c = coords(inner(p, "coordinates"))[0];
      if (c) features.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: { kind: "point", color: st.icon?.color ?? DEFAULT_COLOR, hover, minzoom: 0 } });
      if (c && name) features.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: { kind: "text", text: name, color: "#ffffff", size: 11, dx: 0, dy: -14, hover, minzoom: 0 } });
    }
    for (const l of all(pm, "LineString")) {
      const c = coords(inner(l, "coordinates"));
      if (c.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: c }, properties: { kind: "line", ...line, hover, minzoom: 0 } });
    }
    for (const poly of all(pm, "Polygon")) {
      const outer = coords(inner(inner(poly, "outerBoundaryIs") ?? "", "coordinates"));
      if (outer.length < 3) continue;
      const holes = all(poly, "innerBoundaryIs").map((h) => coords(inner(h, "coordinates"))).filter((h) => h.length >= 3);
      const rings = [outer, ...holes];
      if (st.fill !== null) {
        const fill = st.fill ?? { color: line.color, opacity: 0.35 };
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: rings }, properties: { kind: "fill", ...fill, hover, minzoom: 0 } });
      }
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: outer }, properties: { kind: "line", ...line, hover, minzoom: 0 } });
    }
  }
  const doc = inner(xml, "Document") ?? xml;
  return { title: plainText(inner(doc.replace(/<(?:\w+:)?Placemark[\s\S]*$/i, ""), "name")) ?? null, refreshSec: null, iconFiles: [], features };
}
