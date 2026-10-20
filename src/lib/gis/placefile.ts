/**
 * GRLevelX placefiles (the text format GRLevel3 / GR2Analyst read): chaser
 * positions, threat boxes, roads and labels that people and services publish
 * for radar viewers. Supported:
 *
 *   Title:, Refresh: (minutes), RefreshSeconds:, Threshold: (nm), Color:, Font:,
 *   IconFile:, Icon:, Text:, Place:, Line: … End:, Polygon: … End:,
 *   Triangles: … End:, Object: … End: (icons and text placed in pixels around
 *   a point).
 *
 * Image: blocks and lines drawn inside an Object (pixel offsets) are skipped.
 * Lines starting with ; or // are comments; keywords are case-insensitive.
 */
import { hex, type GisData, type GisFeature, type GisProps, type IconFile } from "./types";

/** Whether text is a placefile at all (some feeds answer with an HTML error page instead). */
export const looksLikePlacefile = (s: string) =>
  !/^\s*</.test(s) && /^\s*(Title|Refresh|RefreshSeconds|Threshold|Color|Font|Object|Line|Polygon|Triangles|Icon|IconFile|Text|Place)\s*:/im.test(s);

/** Comma-separated arguments; commas inside double quotes stay, the quotes go. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** Placefile hover text uses a literal \n for new lines (and is sometimes split into several quoted parts). */
const text = (s: string | undefined) =>
  s
    ?.replace(/\\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n") || undefined;
const num = (s: string | undefined) => (s == null || s.trim() === "" ? NaN : Number(s));
const validLatLon = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/**
 * GRLevelX shows a placefile's items only once zoomed in closer than its
 * threshold (nautical miles across the view's half-width). As a map zoom: the
 * zoom where a ~1000 px wide view spans that, at mid latitudes. 900 nm or
 * more (999 is the usual "always") is always.
 */
export function thresholdToMinzoom(nm: number | null): number {
  if (nm == null || !Number.isFinite(nm) || nm <= 0 || nm >= 900) return 0;
  return Math.max(0, Math.min(20, Math.log2(18_700 / nm)));
}

type Block =
  | { type: "line"; width: number; hover?: string; coords: [number, number][]; color: string; opacity: number }
  | { type: "polygon"; hover?: string; coords: [number, number][]; color: string | null; opacity: number }
  | { type: "triangles"; coords: [number, number][]; colors: ({ color: string; opacity: number } | null)[] }
  /** `minzoom` is the threshold outside it: a Threshold inside an Object is the object's own. */
  | { type: "object"; lat: number; lon: number; minzoom: number }
  | { type: "skip" };

export function parsePlacefile(src: string, base?: string): GisData {
  const data: GisData = { title: null, refreshSec: null, iconFiles: [], features: [] };
  let color = "#ffffff";
  let opacity = 1;
  let minzoom = 0;
  const fonts = new Map<number, number>();
  const stack: Block[] = [];
  const top = () => stack.at(-1);
  const inObject = () => stack.some((b) => b.type === "object");
  const push = (props: GisProps, coordinates: [number, number] | [number, number][] | [number, number][][], type: "Point" | "LineString" | "Polygon") =>
    data.features.push({ type: "Feature", geometry: { type, coordinates } as GisFeature["geometry"], properties: props });
  const fontSize = (n: number) => fonts.get(n) ?? 12;

  const close = () => {
    const b = stack.pop();
    if (!b) return;
    if (b.type === "object") minzoom = b.minzoom;
    if (b.type === "line" && b.coords.length >= 2) push({ kind: "line", color: b.color, opacity: b.opacity, width: b.width, hover: b.hover, minzoom }, b.coords, "LineString");
    if (b.type === "polygon" && b.coords.length >= 3) {
      const ring = [...b.coords];
      if (ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1]) ring.push(ring[0]!);
      push({ kind: "fill", color: b.color ?? color, opacity: b.color ? b.opacity : opacity, hover: b.hover, minzoom }, [ring], "Polygon");
    }
    if (b.type === "triangles")
      for (let i = 0; i + 2 < b.coords.length; i += 3) {
        const c = b.colors[i] ?? { color, opacity };
        push({ kind: "fill", color: c.color, opacity: c.opacity, minzoom }, [[b.coords[i]!, b.coords[i + 1]!, b.coords[i + 2]!, b.coords[i]!]], "Polygon");
      }
  };

  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("//")) continue;
    const m = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    const b = top();

    if (!m) {
      // A vertex inside Line / Polygon / Triangles: "lat, lon[, r, g, b[, a]]".
      if (!b || b.type === "object" || b.type === "skip") continue;
      const a = splitArgs(line).map(num);
      const lat = a[0]!;
      const lon = a[1]!;
      if (!validLatLon(lat, lon)) continue;
      const vertexColor = a.length >= 5 && a.slice(2, 5).every(Number.isFinite) ? { color: hex(a[2]!, a[3]!, a[4]!), opacity: Number.isFinite(a[5]) ? a[5]! / 255 : 1 } : null;
      b.coords.push([lon, lat]);
      if (b.type === "polygon" && vertexColor && b.color == null) {
        b.color = vertexColor.color;
        b.opacity = vertexColor.opacity;
      }
      if (b.type === "triangles") b.colors.push(vertexColor);
      continue;
    }

    const key = m[1]!.toLowerCase();
    const rest = m[2]!;
    if (b?.type === "skip" && key !== "end") continue;
    const a = splitArgs(rest);

    switch (key) {
      case "title":
        data.title = rest.trim() || null;
        break;
      case "refresh":
        if (num(a[0]) > 0) data.refreshSec = num(a[0]) * 60;
        break;
      case "refreshseconds":
        if (num(a[0]) > 0) data.refreshSec = num(a[0]);
        break;
      case "threshold":
        minzoom = thresholdToMinzoom(num(a[0]));
        break;
      case "color": {
        const c = rest
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .filter(Number.isFinite);
        if (c.length >= 3) {
          color = hex(c[0]!, c[1]!, c[2]!);
          opacity = c.length >= 4 ? Math.max(0, Math.min(1, c[3]! / 255)) : 1;
        }
        break;
      }
      case "font":
        if (Number.isFinite(num(a[0])) && num(a[1]) > 0) fonts.set(num(a[0]), Math.min(40, num(a[1])));
        break;
      case "iconfile": {
        const [n, w, h, hotX, hotY] = a.slice(0, 5).map(num);
        const file = a[5];
        if (![n, w, h].every((v) => Number.isFinite(v) && v! > 0) || !file) break;
        let url: string;
        try {
          url = new URL(file, base).toString();
        } catch {
          break;
        }
        data.iconFiles = [...data.iconFiles.filter((f) => f.n !== n), { n: n!, w: w!, h: h!, hotX: Number.isFinite(hotX) ? hotX! : w! / 2, hotY: Number.isFinite(hotY) ? hotY! : h! / 2, url } satisfies IconFile];
        break;
      }
      case "object": {
        const lat = num(a[0]);
        const lon = num(a[1]);
        stack.push(validLatLon(lat, lon) ? { type: "object", lat, lon, minzoom } : { type: "skip" });
        break;
      }
      case "line":
        // Inside an Object, lines are drawn in pixels around the point: not supported.
        stack.push(inObject() ? { type: "skip" } : { type: "line", width: Math.max(0.5, Math.min(20, num(a[0]) || 1)), hover: text(a[2]), coords: [], color, opacity });
        break;
      case "polygon":
        stack.push(inObject() ? { type: "skip" } : { type: "polygon", hover: text(a[0]), coords: [], color: null, opacity });
        break;
      case "triangles":
        stack.push(inObject() ? { type: "skip" } : { type: "triangles", coords: [], colors: [] });
        break;
      case "image":
        stack.push({ type: "skip" });
        break;
      case "end":
        close();
        break;
      case "icon": {
        // Icon: lat, lon, angle, file, number, "hover" (in an Object: x, y instead of lat, lon).
        const obj = stack.findLast((s) => s.type === "object");
        const [p, q, angle, file, n] = a.slice(0, 5).map(num);
        const at: [number, number] | null = obj?.type === "object" ? [obj.lon, obj.lat] : validLatLon(p!, q!) ? [q!, p!] : null;
        if (!at || !Number.isFinite(file) || !Number.isFinite(n)) break;
        const off = obj ? [p || 0, -(q || 0)] : [0, 0];
        push({ kind: "icon", icon: `${file}-${n}`, rotate: Number.isFinite(angle) ? angle! : 0, dx: off[0]!, dy: off[1]!, hover: text(a[5]), minzoom }, at, "Point");
        break;
      }
      case "text": {
        // Text: lat, lon, font, "text", "hover" (in an Object: x, y instead of lat, lon).
        const obj = stack.findLast((s) => s.type === "object");
        const [p, q, font] = a.slice(0, 3).map(num);
        const label = text(a[3]);
        const at: [number, number] | null = obj?.type === "object" ? [obj.lon, obj.lat] : validLatLon(p!, q!) ? [q!, p!] : null;
        if (!at || !label) break;
        const off = obj ? [p || 0, -(q || 0)] : [0, 0];
        push({ kind: "text", text: label, color, size: fontSize(font!), dx: off[0]!, dy: off[1]!, hover: text(a[4]), minzoom }, at, "Point");
        break;
      }
      case "place": {
        // Place: lat, lon, name
        const lat = num(a[0]);
        const lon = num(a[1]);
        const label = text(a.slice(2).join(", "));
        if (validLatLon(lat, lon) && label) push({ kind: "text", text: label, color, size: fontSize(1), dx: 0, dy: 0, minzoom }, [lon, lat], "Point");
        break;
      }
      default:
        break;
    }
  }
  while (stack.length) close();
  return data;
}
