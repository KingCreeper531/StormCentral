"use client";

import type { FeatureCollection } from "geojson";
import type { MapMouseEvent } from "maplibre-gl";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StormCell } from "@/lib/feeds/storm-cells";
import { haversineKm, type LatLon } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { bearingLabel, greatCircleLine, measure, minutesToCover } from "@/lib/range-rings";
import { useFormat } from "@/hooks/use-format";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useMediaQuery } from "@/hooks/use-media-query";
import { IconButton } from "../ui/button";
import { claimClicks } from "./layers/use-layer-click";
import { useGeoJsonLayers } from "./layers/use-geojson-source";
import { mapAlive, SLOTS, useMapContext } from "./map-view";

const SRC = "measure";
/** A start this close to a radar storm cell measures from that storm: its speed gives the time to cover the distance. */
const CELL_KM = 10;
const KT_PER_MS = 1.943844;
/** MapLibre's default click tolerance (px): a press that moves this far is a drag, and gets no click. */
const CLICK_PX = 3;

type Ends = { a: LatLon | null; b: LatLon | null };
const toLatLon = (e: MapMouseEvent): LatLon => ({ lat: e.lngLat.lat, lon: e.lngLat.lng });

/**
 * Distance and bearing between two points on the radar map (RadarScope's
 * ruler): tap a start and an end, or drag with the mouse; a third tap starts
 * over, Esc clears (with nothing to clear, it ends), the close button ends
 * it. While it's open it has the map's clicks (warnings, reports and cameras
 * don't open) and a mouse drag measures instead of panning; touch still pans
 * and zooms. Mounted inside the MapView only while measuring.
 */
export function MeasureTool({ cells = [], onClose }: { cells?: readonly StormCell[]; onClose: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const { map, dark } = useMapContext();
  const mouse = useMediaQuery("(pointer: fine)");
  const [ends, setEnds] = useState<Ends>({ a: null, b: null });
  /** With a mouse, the line follows the pointer until the end is placed. */
  const [hover, setHover] = useState<LatLon | null>(null);
  const drag = useRef<{ start: LatLon; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!mapAlive(map)) return;
    claimClicks(map, true);
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";
    // Two quick clicks are a start and an end, not a zoom.
    const dblZoom = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();

    const click = (e: MapMouseEvent) => {
      const p = toLatLon(e);
      setEnds((s) => (!s.a || s.b ? { a: p, b: null } : { a: s.a, b: p }));
    };
    const down = (e: MapMouseEvent) => {
      const o = e.originalEvent;
      if (o.button !== 0 || o.shiftKey || o.ctrlKey || o.metaKey || o.altKey) return;
      // Keeps the map from panning: this drag is a measurement.
      e.preventDefault();
      drag.current = { start: toLatLon(e), x: e.point.x, y: e.point.y, moved: false };
    };
    const move = (e: MapMouseEvent) => {
      const d = drag.current;
      if (d && (d.moved || Math.hypot(e.point.x - d.x, e.point.y - d.y) >= CLICK_PX)) {
        d.moved = true;
        setEnds({ a: d.start, b: toLatLon(e) });
        return;
      }
      setHover(toLatLon(e));
    };
    // A drag ends without a click, so it stays as drawn.
    const up = () => {
      drag.current = null;
    };
    const out = () => {
      drag.current = null;
      setHover(null);
    };
    map.on("click", click);
    map.on("mousedown", down);
    map.on("mousemove", move);
    map.on("mouseup", up);
    map.on("mouseout", out);
    return () => {
      claimClicks(map, false);
      if (!mapAlive(map)) return;
      canvas.style.cursor = "";
      if (dblZoom) map.doubleClickZoom.enable();
      map.off("click", click);
      map.off("mousedown", down);
      map.off("mousemove", move);
      map.off("mouseup", up);
      map.off("mouseout", out);
    };
  }, [map]);

  useHotkeys({ Escape: () => (ends.a ? setEnds({ a: null, b: null }) : onClose()) });

  const { a } = ends;
  const b = ends.b ?? (mouse ? hover : null);
  const m = a && b && (a.lat !== b.lat || a.lon !== b.lon) ? measure(a, b) : null;
  const text = m ? t("{distance} at {bearing} {compass}", { distance: fmt.distanceKm(m.km), bearing: bearingLabel(m.bearing), compass: t(m.compass) }) : null;

  const data = useMemo<FeatureCollection>(() => {
    const f: FeatureCollection["features"] = [];
    if (a && b) f.push({ type: "Feature", geometry: { type: "LineString", coordinates: greatCircleLine(a, b) }, properties: { kind: "line" } });
    for (const p of [a, ends.b]) if (p) f.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { kind: "end" } });
    return { type: "FeatureCollection", features: f };
  }, [a, b, ends.b]);

  // A storm cell at the start: how long it takes, at its speed, to go the distance.
  const cell = useMemo(() => {
    if (!a) return null;
    let best: { cell: StormCell; km: number } | null = null;
    for (const c of cells) {
      if (!c.motion) continue;
      const km = haversineKm(a, c);
      if (km <= CELL_KM && (!best || km < best.km)) best = { cell: c, km };
    }
    return best?.cell ?? null;
  }, [a, cells]);
  const minutes = m && cell?.motion ? minutesToCover(m.km, cell.motion.speedKt) : null;
  const speed = cell?.motion ? fmt.wind(cell.motion.speedKt / KT_PER_MS) : "";

  const line = dark ? "#ffd60a" : "#b45309";
  useGeoJsonLayers(
    SRC,
    data,
    () => [
      {
        id: "measure-casing",
        type: "line",
        source: SRC,
        filter: ["==", ["get", "kind"], "line"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "rgba(0,0,0,0.55)", "line-width": 5 },
      },
      {
        id: "measure-line",
        type: "line",
        source: SRC,
        filter: ["==", ["get", "kind"], "line"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": line, "line-width": 2.5 },
      },
      {
        id: "measure-ends",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "kind"], "end"],
        paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-color": "#000000", "circle-stroke-width": 1.5 },
      },
    ],
    SLOTS.reports,
  );

  return (
    <div role="status" className="overlay absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 py-1 pr-1 pl-3">
      <div className="min-w-0 text-[13px]">
        {text ? (
          <p className="font-semibold text-ink tabular">{text}</p>
        ) : (
          <p className="text-ink-2">{mouse ? t("Click two points or drag to measure") : t("Tap two points to measure")}</p>
        )}
        {minutes != null && (
          <p className="text-xs text-ink-3 tabular">
            {minutes < 120
              ? t("~{n} min at this storm's speed ({speed})", { n: Math.max(1, Math.round(minutes)), speed })
              : t("~{h} h at this storm's speed ({speed})", { h: Math.round(minutes / 60), speed })}
          </p>
        )}
      </div>
      <IconButton size="sm" label={t("Stop measuring")} onClick={onClose}>
        <X className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}
