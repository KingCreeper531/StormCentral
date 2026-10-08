"use client";

import { useEffect, useMemo, useRef } from "react";
import { useForecast } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
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

/**
 * The temperature as a tray icon: bold white digits with a dark outline on a
 * transparent background, so it reads on light and dark taskbars. Digits are
 * fitted to the width, then stretched up to 1.35x vertically for legibility
 * once Windows shows the icon at 16 px.
 */
function temperatureIcon(label: string): string | undefined {
  const cached = iconCache.get(label);
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

  const url = canvas.toDataURL("image/png");
  iconCache.set(label, url);
  return url;
}

/**
 * Desktop app only: keeps the tray icon and tooltip on the current
 * temperature and conditions at the selected location, in the user's units.
 * Sends an update only when what the tray shows would change. Renders nothing.
 */
export function DesktopTraySync() {
  const forecast = useForecast();
  const place = useAppStore((s) => s.location.name);
  const fmt = useFormat();
  const lastSent = useRef("");

  // Placeholder data is the previous location's forecast; wait for the real one.
  const current = forecast.isPlaceholderData ? undefined : forecast.data?.current;
  const tempC = current?.temp ?? null;
  const code = current?.code ?? null;
  const hasData = current !== undefined;

  const status = useMemo(() => {
    if (!hasData) return null;
    const name = place.length > MAX_PLACE ? `${place.slice(0, MAX_PLACE - 1)}…` : place;
    if (tempC == null) return { text: "", tooltip: name, label: null };
    const condition = describeCode(code).label;
    const temp = fmt.temp(tempC, true);
    return {
      text: temp,
      tooltip: `${name} · ${temp}${condition !== "—" ? `, ${condition.toLowerCase()}` : ""}`,
      label: iconLabel(tempC, fmt.units.temp),
    };
  }, [hasData, place, tempC, code, fmt]);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge || !status) return;
    const key = `${status.label ?? ""}\n${status.text}\n${status.tooltip}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    const next: TrayStatus = { text: status.text, tooltip: status.tooltip };
    const icon = status.label ? temperatureIcon(status.label) : undefined;
    if (icon) next.iconDataUrl = icon;
    bridge.setTrayStatus(next);
  }, [status]);

  return null;
}
