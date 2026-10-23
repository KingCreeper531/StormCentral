"use client";

import { Layers } from "lucide-react";
import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNow } from "@/hooks/use-now";
import type { RadarLoop } from "@/hooks/use-radar-loop";
import type { WeatherAlert } from "@/lib/api/types";
import { drawBroadcast } from "@/lib/broadcast/canvas";
import { broadcastWarnings, tickerItems, warningLowerThird, type LowerThird } from "@/lib/broadcast/graphics";
import { useT } from "@/lib/i18n/use-t";
import type { ExportLoopOptions } from "@/lib/radar/export-loop";
import { useBroadcastStore } from "@/store/broadcast-store";
import { ExportLoopButton } from "../radar/export-loop-dialog";
import { IconButton } from "../ui/button";
import { BroadcastControls, useSceneTour } from "./broadcast-controls";
import { BroadcastDialog } from "./broadcast-dialog";
import { BroadcastLayers } from "./broadcast-layers";
import { BroadcastOverlay } from "./broadcast-overlay";

/** The map's view as a scene to save. */
const viewOf = (map: MlMap | null, name: string) => {
  if (!map) return null;
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng, zoom: map.getZoom(), name };
};

/**
 * Broadcast mode on the radar map (the /broadcast page): the app's chrome
 * hidden, on-air graphics over the map, a control bar that hides itself,
 * scenes and tours, loop exports with the same graphics, and a layers and
 * plugins menu. Picking a warning on the map puts it in the lower third with
 * a countdown.
 */
export function BroadcastStage({
  map,
  loop,
  speed,
  alerts,
  activeAlert,
  title,
  placeName,
  timeZone,
  onExit,
  extra,
  layers,
}: {
  map: MlMap | null;
  loop: RadarLoop;
  speed: number;
  /** Every alert the map has; the graphics follow the official warnings among them. */
  alerts: readonly WeatherAlert[];
  activeAlert: WeatherAlert | undefined;
  /** The radar product, e.g. "NEXRAD mosaic, reflectivity". */
  title: string;
  placeName: string;
  timeZone?: string;
  onExit: () => void;
  /** More buttons for the control bar (drawing). */
  extra?: React.ReactNode;
  /** The map's layer controls, for the layers and plugins menu. */
  layers: React.ReactNode;
}) {
  const t = useT();
  const now = useNow(30_000);
  const s = useBroadcastStore();
  const tour = useSceneTour(map);
  const [settings, setSettings] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  // No app chrome while on air.
  useEffect(() => {
    document.documentElement.dataset.broadcast = "on";
    return () => {
      delete document.documentElement.dataset.broadcast;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Moving the map by hand leaves the scene.
  const { leave } = tour;
  useEffect(() => {
    if (!map) return;
    const onDrag = (e: MapMouseEvent | { originalEvent?: unknown }) => {
      if (e.originalEvent) leave();
    };
    map.on("dragstart", onDrag);
    return () => {
      map.off("dragstart", onDrag);
    };
  }, [map, leave]);

  const warnings = useMemo(() => broadcastWarnings(alerts, now), [alerts, now]);
  const scene = tour.current;
  const lower = useMemo<LowerThird>(() => {
    if (activeAlert) return warningLowerThird(activeAlert, timeZone, t);
    if (scene) return { title: scene.name.toUpperCase(), subtitle: title, color: s.accent, ends: null };
    return { title: (placeName || title).toUpperCase(), subtitle: title, color: s.accent, ends: null };
  }, [activeAlert, scene, title, placeName, timeZone, t, s.accent]);
  const lowerKey = activeAlert?.id ?? scene?.id ?? "view";

  // The logo, decoded once for exported frames.
  const logo = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = s.logo ?? "/icon.svg";
    logo.current = img;
  }, [s.logo]);

  const overlay = useCallback<NonNullable<ExportLoopOptions["overlay"]>>(
    (ctx, w, h, frame) =>
      drawBroadcast(
        ctx,
        w,
        h,
        {
          name: s.name || "Storm Central",
          tagline: s.tagline,
          live: s.live,
          accent: s.accent,
          logo: logo.current?.complete && logo.current.naturalWidth ? logo.current : null,
          parts: { bug: s.parts.bug, clock: s.parts.clock, lower: s.parts.lower, ticker: s.parts.ticker },
          lower,
          ticker: tickerItems(warnings, timeZone, t),
          // Frames that aren't observed say what they are, like the radar legend.
          timeLabel: frame.nowcast ? t("Extrapolated").toLocaleUpperCase(t.locale) : frame.forecast ? t("HRRR forecast").toLocaleUpperCase(t.locale) : t("RADAR"),
          tickerLabel: t("WARNINGS"),
          liveLabel: t("LIVE"),
        },
        frame.time,
        frame.date,
        frame.fontFamily,
      ),
    [s, lower, warnings, timeZone, t],
  );

  return (
    <>
      <BroadcastOverlay warnings={warnings} lower={lower} lowerKey={lowerKey} timeZone={timeZone} />
      <BroadcastControls
        tour={tour}
        onSettings={() => setSettings(true)}
        onExit={onExit}
        extra={
          <>
            <IconButton size="sm" label={t("Layers and plugins")} aria-pressed={layersOpen} onClick={() => setLayersOpen(!layersOpen)}>
              <Layers className="size-4" aria-hidden />
            </IconButton>
            {extra}
            <ExportLoopButton size="sm" map={map} loop={loop} speed={speed} title={title} subtitle={placeName} timeZone={timeZone} overlay={overlay} />
          </>
        }
      />
      <BroadcastLayers open={layersOpen} onClose={() => setLayersOpen(false)} layers={layers} />
      <BroadcastDialog open={settings} onClose={() => setSettings(false)} currentView={() => viewOf(map, t("Scene {n}", { n: s.scenes.length + 1 }))} />
    </>
  );
}
