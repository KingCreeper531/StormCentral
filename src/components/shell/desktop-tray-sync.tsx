"use client";

import { useEffect, useMemo, useRef } from "react";
import { useForecast, useLocalAlerts } from "@/hooks/queries";
import type { WeatherAlert } from "@/lib/api/types";
import { alertCategory, alertMatchesLevel } from "@/lib/alerting/engine";
import { clockFromIso } from "@/lib/alerting/format";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import { desktopBridge, type TrayStatus } from "@/lib/native/desktop";
import { convertTemp, type TempUnit } from "@/lib/weather/units";
import { describeCode } from "@/lib/weather/wmo";
import { useAppStore } from "@/store/app-store";

/** Drawn at 32 px: the 2x form of a 16 px tray icon. */
const ICON_PX = 32;
const OUTLINE_PX = 4;
/** Keeps the tooltip inside Windows' 127-character limit. */
const MAX_PLACE = 80;

/** The rounded temperature in at most 3 characters ("76", "-4", "104"), or null if it doesn't fit. */
function iconLabel(tempC: number, unit: TempUnit): string | null {
  const v = Math.round(convertTemp(tempC, unit));
  const s = String(v); // String(-0) is "0"
  return s.length <= 3 ? s : null;
}

const iconCache = new Map<string, string>();

/** Badge colours: red for tornado and emergencies, orange for other warnings. */
const BADGE = { red: "#ff3b30", orange: "#ff9f0a" } as const;
type Badge = keyof typeof BADGE;

/** The most serious active warning at the location, if any (tornado and emergencies first). */
export function topWarning(alerts: readonly WeatherAlert[] | undefined, now: number): { alert: WeatherAlert; badge: Badge } | null {
  const active = (alerts ?? []).filter((a) => alertMatchesLevel(a, "warnings") && Date.parse(a.ends ?? a.expires) > now);
  if (!active.length) return null;
  const rank = (a: WeatherAlert) => (a.tags.some((t) => /EMERGENCY/.test(t)) ? 3 : alertCategory(a.event) === "tornado" ? 2 : 1);
  const alert = [...active].sort((a, b) => rank(b) - rank(a))[0]!;
  return { alert, badge: rank(alert) >= 2 ? "red" : "orange" };
}

/**
 * The temperature as a tray icon: bold white digits with a dark outline on a
 * transparent background, so it reads on light and dark taskbars. Digits are
 * fitted to the width, then stretched up to 1.35x vertically for legibility
 * once Windows shows the icon at 16 px.
 */
function temperatureIcon(label: string, badge: Badge | null = null): string | undefined {
  const key = `${label}|${badge ?? ""}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  const font = (px: number) => `700 ${px}px "Segoe UI", system-ui, sans-serif`;
  const room = ICON_PX - OUTLINE_PX;
  let px = 28;
  ctx.font = font(px);
  const width = ctx.measureText(label).width;
  if (width > room) {
    px = Math.floor((px * room) / width);
    ctx.font = font(px);
  }
  const m = ctx.measureText(label);
  const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const stretch = height > 0 ? Math.min(1.35, room / height) : 1;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = OUTLINE_PX;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fillStyle = "#ffffff";
  // Centre the ink box vertically, in the stretched coordinate space.
  ctx.setTransform(1, 0, 0, stretch, 0, 0);
  const baseline = (ICON_PX / stretch + m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.strokeText(label, ICON_PX / 2, baseline);
  ctx.fillText(label, ICON_PX / 2, baseline);

  // An active warning: a coloured dot in the top-right corner, outlined so it reads on any taskbar.
  if (badge) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.arc(ICON_PX - 7, 7, 6, 0, Math.PI * 2);
    ctx.fillStyle = BADGE[badge];
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fill();
    ctx.stroke();
  }

  const url = canvas.toDataURL("image/png");
  iconCache.set(key, url);
  return url;
}

/**
 * Desktop app only: keeps the tray icon and tooltip on the current
 * temperature and conditions at the selected location, in the user's units.
 * An active warning there adds a red or orange dot to the icon and leads the
 * tooltip ("Tornado Warning until 4:30 PM"). Sends an update only when what
 * the tray shows would change. Renders nothing.
 */
export function DesktopTraySync() {
  const forecast = useForecast();
  const alerts = useLocalAlerts().data?.alerts;
  const place = useAppStore((s) => s.location.name);
  const fmt = useFormat();
  const lastSent = useRef("");

  // Placeholder data is the previous location's forecast; wait for the real one.
  const current = forecast.isPlaceholderData ? undefined : forecast.data?.current;
  const tempC = current?.temp ?? null;
  const code = current?.code ?? null;
  const hasData = current !== undefined;

  // Re-checked every minute, so an expired warning drops off even between alert refreshes.
  const now = useNow(60_000);
  const warning = useMemo(() => topWarning(alerts, now), [alerts, now]);

  const status = useMemo(() => {
    if (!hasData) return null;
    const lead = warning ? `${warning.alert.event} until ${clockFromIso(warning.alert.ends ?? warning.alert.expires)}\n` : "";
    const room = MAX_PLACE - Math.max(0, lead.length - 40);
    const name = place.length > room ? `${place.slice(0, room - 1)}…` : place;
    if (tempC == null) return { text: "", tooltip: lead + name, label: null, badge: warning?.badge ?? null };
    const condition = describeCode(code).label;
    const temp = fmt.temp(tempC, true);
    return {
      text: temp,
      tooltip: `${lead}${name} · ${temp}${condition !== "—" ? `, ${condition.toLowerCase()}` : ""}`,
      label: iconLabel(tempC, fmt.units.temp),
      badge: warning?.badge ?? null,
    };
  }, [hasData, place, tempC, code, fmt, warning]);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge || !status) return;
    const key = `${status.label ?? ""}\n${status.badge ?? ""}\n${status.text}\n${status.tooltip}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    const next: TrayStatus = { text: status.text, tooltip: status.tooltip };
    const icon = status.label ? temperatureIcon(status.label, status.badge) : undefined;
    if (icon) next.iconDataUrl = icon;
    bridge.setTrayStatus(next);
  }, [status]);

  return null;
}
