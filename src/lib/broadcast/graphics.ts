/**
 * What broadcast mode's graphics say (components/broadcast): the warning
 * codes and colours, the active-warnings counts, the ticker and the lower
 * third. The same codes and colours as the 24/7 live stream (stream/plan.ts),
 * so a clip from the app and the stream look like one station. Pure, and in
 * the person's language, so the on-screen overlay and an exported video say
 * the same words.
 */
import type { WeatherAlert } from "../api/types";
import { translator, type Translator } from "../i18n";
import { eventName } from "../i18n/nws-events";

/** The warnings broadcast graphics follow, most serious first. */
export const BROADCAST_EVENTS = ["Tornado Warning", "Extreme Wind Warning", "Severe Thunderstorm Warning", "Flash Flood Warning"] as const;
export type BroadcastEvent = (typeof BROADCAST_EVENTS)[number];

/** Brighter than the NWS map colours, for a dark screen. */
export const EVENT_STYLE: Record<BroadcastEvent, { code: string; label: string; color: string }> = {
  "Tornado Warning": { code: "TOR", label: "Tornado", color: "#ff3b3b" },
  "Extreme Wind Warning": { code: "EWW", label: "Extreme wind", color: "#ff7a1a" },
  "Severe Thunderstorm Warning": { code: "SVR", label: "Severe storm", color: "#ffb020" },
  "Flash Flood Warning": { code: "FFW", label: "Flash flood", color: "#2fd27c" },
};
/** Emergencies and PDS warnings stand out from the rest. */
export const EMERGENCY_COLOR = "#ff2bd6";

const EN = translator("en");
const isEvent = (e: string): e is BroadcastEvent => (BROADCAST_EVENTS as readonly string[]).includes(e);
const emergency = (a: Pick<WeatherAlert, "tags">) => a.tags.some((t) => /EMERGENCY/.test(t) || t === "PDS");

/**
 * Official warnings of the kinds above that haven't expired, most serious
 * first, then soonest to end. Each once: the map's lists overlap (the
 * national list and the one for your area carry the same warnings).
 */
export function broadcastWarnings(alerts: readonly WeatherAlert[], now: number): WeatherAlert[] {
  const seen = new Set<string>();
  return alerts
    .filter((a) => isEvent(a.event) && (a.source ?? "nws") === "nws" && Date.parse(a.ends ?? a.expires) > now && !seen.has(a.id) && !!seen.add(a.id))
    .sort((x, y) => y.rank - x.rank || Date.parse(x.ends ?? x.expires) - Date.parse(y.ends ?? y.expires));
}

/** The name to show: emergencies and PDS warnings by their own names. */
export function warningName(a: Pick<WeatherAlert, "event" | "tags">, t: Translator = EN): string {
  if (a.tags.includes("TORNADO EMERGENCY")) return eventName(t.lang, "Tornado Emergency");
  if (a.tags.includes("FLASH FLOOD EMERGENCY")) return eventName(t.lang, "Flash Flood Emergency");
  if (a.tags.includes("PDS")) return t("PDS {event}", { event: eventName(t.lang, a.event) });
  return eventName(t.lang, a.event);
}

export function styleOf(a: Pick<WeatherAlert, "event" | "tags" | "color">): { code: string; color: string } {
  if (emergency(a)) return { code: a.tags.includes("PDS") ? "PDS" : "EMERG", color: EMERGENCY_COLOR };
  const s = isEvent(a.event) ? EVENT_STYLE[a.event] : null;
  return { code: s?.code ?? "WRN", color: s?.color ?? a.color };
}

/** "Oklahoma, Cleveland and McClain" or "Oklahoma, Cleveland and 4 more", from the NWS's "A; B; C" area list. */
export function shortAreas(areaDesc: string, t: Translator = EN, max = 3): string {
  const parts = areaDesc
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length <= max) return t("{list} and {last}", { list: parts.slice(0, -1).join(", "), last: parts.at(-1)! });
  return t("{list} and {n} more", { list: parts.slice(0, max - 1).join(", "), n: parts.length - (max - 1) });
}

/** The active-warnings panel: each kind with its count, most serious first, zero counts left out. */
export function warningCounts(ws: readonly WeatherAlert[], t: Translator = EN): { code: string; label: string; n: number; color: string }[] {
  return BROADCAST_EVENTS.map((e) => ({ ...EVENT_STYLE[e], label: t(EVENT_STYLE[e].label), n: ws.filter((w) => w.event === e).length })).filter((c) => c.n > 0);
}

/** "5:45 PM" in the given zone. */
export function clockLabel(iso: string, timeZone: string | undefined, locale?: string): string {
  const opts = { hour: "numeric", minute: "2-digit" } as const;
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(Date.parse(iso));
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(Date.parse(iso));
  }
}

export interface TickerItem {
  code: string;
  color: string;
  text: string;
}

/** The ticker: each warning, short, with its code and colour; capped, with a count of the rest. */
export function tickerItems(ws: readonly WeatherAlert[], timeZone: string | undefined, t: Translator = EN, max = 30): TickerItem[] {
  const items = ws.slice(0, max).map((w) => ({
    ...styleOf(w),
    text: t("{name}: {areas} until {time}", { name: warningName(w, t), areas: shortAreas(w.areaDesc, t), time: clockLabel(w.ends ?? w.expires, timeZone, t.locale) }),
  }));
  return ws.length > max ? [...items, { code: "+", color: "#9aa4b8", text: t("and {n} more", { n: ws.length - max }) }] : items;
}

/** "12:04" counting down to a time (minutes:seconds under an hour, else h:mm:ss); "0:00" once it's passed. */
export function countdown(untilIso: string, now: number): string {
  const s = Math.max(0, Math.floor((Date.parse(untilIso) - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export interface LowerThird {
  title: string;
  subtitle: string;
  color: string;
  /** Counted down to, for a warning. */
  ends: string | null;
}

/** The lower third for a warning: its name, then where and until when. */
export function warningLowerThird(a: WeatherAlert, timeZone: string | undefined, t: Translator = EN): LowerThird {
  return {
    title: warningName(a, t).toUpperCase(),
    subtitle: t("{areas} · until {time}", { areas: shortAreas(a.areaDesc, t, 4), time: clockLabel(a.ends ?? a.expires, timeZone, t.locale) }),
    color: styleOf(a).color,
    ends: a.ends ?? a.expires,
  };
}
