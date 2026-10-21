"use client";

import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useNow } from "@/hooks/use-now";
import type { RadarLoop } from "@/hooks/use-radar-loop";
import type { WeatherAlert } from "@/lib/api/types";
import { drawBroadcast } from "@/lib/broadcast/canvas";
import { broadcastWarnings, tickerItems, warningLowerThird, type LowerThird } from "@/lib/broadcast/graphics";
import { useT } from "@/lib/i18n/use-t";
import type { ExportLoopOptions } from "@/lib/radar/export-loop";
import { useBroadcastStore } from "@/store/broadcast-store";
import { useDrawStore } from "@/store/draw-store";
import { ExportLoopButton } from "../radar/export-loop-dialog";
import { IconButton } from "../ui/button";
import { BroadcastControls, useSceneTour } from "./broadcast-controls";
import { BroadcastDialog } from "./broadcast-dialog";
import { BroadcastOverlay } from "./broadcast-overlay";

/** The map's view as a scene to save. */
const viewOf = (map: MlMap | null, name: string) => {
  if (!map) return null;
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng, zoom: map.getZoom(), name };
};

/** Opens broadcast settings, from where broadcast mode starts. */
export function BroadcastButton({ map, onStart, size = "sm" }: { map: MlMap | null; onStart: () => void; size?: "sm" | "md" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const scenes = useBroadcastStore((s) => s.scenes.length);
  return (
    <>
      <IconButton size={size} label={t("Broadcast mode")} onClick={() => setOpen(true)} disabled={!map}>
        <Radio className={size === "sm" ? "size-4" : "size-5"} aria-hidden />
      </IconButton>
      <BroadcastDialog
        open={open}
        onClose={() => setOpen(false)}
        onStart={() => {
          setOpen(false);
          onStart();
        }}
        currentView={() => viewOf(map, t("Scene {n}", { n: scenes + 1 }))}
      />
    </>
  );
}

/**
 * Broadcast mode on the radar map: the app's chrome hidden, on-air graphics
 * over the map, a control bar that hides itself, scenes and tours, and loop
 * exports with the same graphics. Picking a warning on the map puts it in the
 * lower third with a countdown.
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
}) {
  const t = useT();
  const now = useNow(30_000);
  const s = useBroadcastStore();
  const tour = useSceneTour(map);
  const [settings, setSettings] = useState(false);

  // No app chrome while on air.
  useEffect(() => {
    document.documentElement.dataset.broadcast = "on";
    return () => {
      delete document.documentElement.dataset.broadcast;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  // The back button or gesture leaves broadcast mode, not the page: going on air adds a history entry
  // (same address), and leaving any other way goes back over it.
  const exitRef = useRef(onExit);
  useEffect(() => {
    exitRef.current = onExit;
  });
  const entry = useRef("");
  useEffect(() => {
    const id = Math.random().toString(36).slice(2);
    entry.current = id;
    window.history.pushState({ broadcast: id }, "");
    const onPop = () => exitRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const exit = useCallback(() => {
    if ((window.history.state as { broadcast?: string } | null)?.broadcast === entry.current) window.history.back();
    else exitRef.current();
  }, []);
  // Esc leaves, unless it's closing a dialog (settings, the export) or the drawing tools first.
  useHotkeys({
    Escape: () => {
      if (!document.querySelector('[role="dialog"][aria-modal="true"]') && !useDrawStore.getState().open) exit();
    },
  });

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
          timeLabel: t("RADAR"),
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
        onExit={exit}
        extra={
          <>
            {extra}
            <ExportLoopButton size="sm" map={map} loop={loop} speed={speed} title={title} subtitle={placeName} timeZone={timeZone} overlay={overlay} />
          </>
        }
      />
      <BroadcastDialog open={settings} onClose={() => setSettings(false)} currentView={() => viewOf(map, t("Scene {n}", { n: s.scenes.length + 1 }))} />
    </>
  );
}
