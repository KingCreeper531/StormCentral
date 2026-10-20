/**
 * Feeds whose own icons don't say what they are get symbols that do.
 * Spotter Network marks every spotter with a plain green, yellow or red dot
 * (how recently they reported) and moving ones with a grey arrow; on our map
 * they're a person badge coloured by the age of their last report, and an
 * arrow pointing where they're heading. The map draws these
 * (lib/gis/symbol-art) and the layer list shows a legend for them.
 */
import type { GisData } from "./types";

export type SymbolId = "spotter-live" | "spotter-recent" | "spotter-old" | "heading";

/** Legend order. */
export const SYMBOLS: readonly SymbolId[] = ["spotter-live", "spotter-recent", "spotter-old", "heading"];

/** A feature's icon is `${file}-${number}` from the placefile's sheets, or one of these. */
export const SYMBOL_PREFIX = "sym:";
export const isSymbol = (icon: string) => icon.startsWith(SYMBOL_PREFIX);
export const symbolOf = (icon: string) => icon.slice(SYMBOL_PREFIX.length) as SymbolId;

/** A report counts as live for this many minutes, and as recent up to an hour. */
export const LIVE_MIN = 15;
export const RECENT_MIN = 60;

const SN_STATUS = /^https?:\/\/(www\.)?spotternetwork\.org\/icon\/spotternet(_new)?\.png$/i;
const SN_ARROWS = /^https?:\/\/(www\.)?spotternetwork\.org\/icon\/arrows\.png$/i;
/** "2026-10-20 21:20:06 UTC" in a spotter's hover text: their last report. */
const REPORTED = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(?:UTC|Z)\b/;

/** Minutes since the report in a spotter's hover text, or null when it has none. */
export function reportAge(hover: string | undefined, now: number): number | null {
  const m = hover ? REPORTED.exec(hover) : null;
  if (!m) return null;
  const at = Date.parse(`${m[1]}T${m[2]}Z`);
  return Number.isFinite(at) ? Math.max(0, (now - at) / 60_000) : null;
}

function spotter(hover: string | undefined, n: number, newSheet: boolean, now: number): SymbolId {
  const age = reportAge(hover, now);
  if (age != null) return age <= LIVE_MIN ? "spotter-live" : age <= RECENT_MIN ? "spotter-recent" : "spotter-old";
  // No time given: the dot's colour says it (spotternet_new.png: four sizes each of green, yellow, red).
  if (newSheet && n >= 1 && n <= 12) return n <= 4 ? "spotter-live" : n <= 8 ? "spotter-recent" : "spotter-old";
  return "spotter-recent";
}

/** Swap well-known feeds' icons for symbols. Symbols sit on their point (pixel offsets are dropped). */
export function restyleKnownFeeds(data: GisData, now: number): GisData {
  const urls = new Map(data.iconFiles.map((f) => [f.n, f.url]));
  let changed = false;
  const features = data.features.map((f) => {
    const p = f.properties;
    if (p.kind !== "icon" || isSymbol(p.icon)) return f;
    const [file, n] = p.icon.split("-").map(Number);
    const url = urls.get(file!) ?? "";
    const sym = SN_ARROWS.test(url) ? "heading" : SN_STATUS.test(url) ? spotter(p.hover, n!, /_new\.png$/i.test(url), now) : null;
    if (!sym) return f;
    changed = true;
    return { ...f, properties: { ...p, icon: SYMBOL_PREFIX + sym, dx: 0, dy: 0 } };
  });
  return changed ? { ...data, features } : data;
}

/** The symbols a layer uses, in legend order. */
export function symbolsUsed(data: GisData): SymbolId[] {
  const used = new Set<string>();
  for (const f of data.features) if (f.properties.kind === "icon" && isSymbol(f.properties.icon)) used.add(symbolOf(f.properties.icon));
  return SYMBOLS.filter((s) => used.has(s));
}

/** Lines that are someone's phone number or email (Spotter Network's feeds carry many). */
const CONTACT_LINE = /^\s*(phone|cell|mobile|tel(ephone)?|e-?mail)\s*[:#=]/i;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /(\+?1[-. ]?)?\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g;

/** Hover text without phone numbers and emails, so they never end up on screen, in a screenshot or on the stream. */
export function withoutContacts(text: string | undefined): string | undefined {
  if (!text) return text;
  const lines = text
    .split("\n")
    .filter((l) => !CONTACT_LINE.test(l))
    .map((l) => l.replace(EMAIL, "").replace(PHONE, "").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
}
