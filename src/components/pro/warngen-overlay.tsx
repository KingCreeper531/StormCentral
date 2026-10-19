"use client";

import type { FeatureCollection } from "geojson";
import type { MapLayerMouseEvent, MapLayerTouchEvent, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import { edgeMidpoints, insertVertex, moveVertex, openRing, removeVertex, type Ring } from "@/lib/warngen/geometry";
import { WARN_PRODUCTS } from "@/lib/warngen/products";
import { useProStore } from "@/store/pro-store";
import { mapAlive, SLOTS, useMapContext } from "../map/map-view";
import { useGeoJsonLayers } from "../map/layers/use-geojson-source";
import { useWarnGeometry } from "./use-warngen";

const SRC = "pro-warngen";

/** A corner drag in any pane, and a short quiet period after it so the release isn't read as a storm pick. */
let dragUntil = 0;
let dragging = false;
export const warngenDragging = () => dragging || Date.now() < dragUntil;

/**
 * The WarnGen draft on a pane: the polygon in the product's colour, its
 * corners (drag to move; right-click or double-click to remove) and edge
 * midpoints (drag to add a corner), and the projected track. Every pane
 * shows the same draft, so a corner can be dragged on whichever product
 * shows the storm best.
 */
export function WarnGenOverlay() {
  const { map } = useMapContext();
  const g = useWarnGeometry();
  const kind = useProStore((s) => s.warnDraft.kind);
  const setDraft = useProStore((s) => s.setWarnDraft);
  const color = WARN_PRODUCTS[kind].color;
  const ringRef = useRef<Ring | null>(g.polygon);
  useEffect(() => {
    ringRef.current = g.polygon;
  });

  const data = useMemo<FeatureCollection>(() => {
    const f: FeatureCollection["features"] = [];
    if (g.polygon) {
      f.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [g.polygon] }, properties: { kind: "poly" } });
      openRing(g.polygon).forEach((p, i) => f.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { kind: "v", i } }));
      edgeMidpoints(g.polygon).forEach((p, i) => f.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { kind: "m", i } }));
    }
    if (g.now && g.end) f.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[g.now.lon, g.now.lat], [g.end.lon, g.end.lat]] }, properties: { kind: "track" } });
    if (g.now) f.push({ type: "Feature", geometry: { type: "Point", coordinates: [g.now.lon, g.now.lat] }, properties: { kind: "now" } });
    return { type: "FeatureCollection", features: f };
  }, [g]);

  useGeoJsonLayers(
    SRC,
    data,
    () => [
      { id: "wg-fill", type: "fill", source: SRC, filter: ["==", ["get", "kind"], "poly"], paint: { "fill-color": color, "fill-opacity": 0.14 } },
      { id: "wg-casing", type: "line", source: SRC, filter: ["==", ["get", "kind"], "poly"], paint: { "line-color": "#000", "line-width": 4.5, "line-opacity": 0.6 } },
      { id: "wg-line", type: "line", source: SRC, filter: ["==", ["get", "kind"], "poly"], paint: { "line-color": color, "line-width": 2.4 } },
      { id: "wg-track", type: "line", source: SRC, filter: ["==", ["get", "kind"], "track"], paint: { "line-color": "#fff", "line-width": 1.5, "line-dasharray": [3, 2] } },
      {
        id: "wg-now",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "kind"], "now"],
        paint: { "circle-radius": 5, "circle-color": color, "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      },
      {
        id: "wg-mid",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "kind"], "m"],
        paint: { "circle-radius": 4, "circle-color": "#fff", "circle-opacity": 0.55, "circle-stroke-color": "#000", "circle-stroke-width": 1 },
      },
      {
        id: "wg-vertex",
        type: "circle",
        source: SRC,
        filter: ["==", ["get", "kind"], "v"],
        paint: { "circle-radius": 6, "circle-color": "#fff", "circle-stroke-color": "#000", "circle-stroke-width": 2 },
      },
    ],
    SLOTS.tracks,
  );
  // The colour is baked into the layer specs above: repaint when the product changes.
  useEffect(() => {
    if (!mapAlive(map) || !map.getLayer("wg-fill")) return;
    map.setPaintProperty("wg-fill", "fill-color", color);
    map.setPaintProperty("wg-line", "line-color", color);
    map.setPaintProperty("wg-now", "circle-color", color);
  }, [map, color]);

  useEffect(() => {
    if (!map) return;
    let index = -1;
    const point = (e: MapMouseEvent | MapTouchEvent): [number, number] => [e.lngLat.lng, e.lngLat.lat];
    const move = (e: MapMouseEvent | MapTouchEvent) => {
      if (index < 0) return;
      const ring = ringRef.current;
      if (ring) setDraft({ polygon: moveVertex(ring, index, point(e)) });
    };
    const end = () => {
      index = -1;
      dragging = false;
      dragUntil = Date.now() + 300;
      map.off("mousemove", move);
      map.off("touchmove", move);
      map.getCanvas().style.cursor = "";
    };
    const start = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      const f = e.features?.[0];
      const ring = ringRef.current;
      if (!f || !ring || ("points" in e && e.points.length > 1)) return;
      // Keep the map from panning while a corner is dragged.
      e.preventDefault();
      const i = Number(f.properties?.i);
      if (f.properties?.kind === "m") {
        setDraft({ polygon: insertVertex(ring, i, point(e)) });
        ringRef.current = insertVertex(ring, i, point(e));
        index = i + 1;
      } else index = i;
      dragging = true;
      map.getCanvas().style.cursor = "grabbing";
      map.on("mousemove", move);
      map.on("touchmove", move);
      map.once("mouseup", end);
      map.once("touchend", end);
    };
    const remove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const ring = ringRef.current;
      if (!f || !ring) return;
      e.preventDefault();
      dragUntil = Date.now() + 300;
      setDraft({ polygon: removeVertex(ring, Number(f.properties?.i)) });
    };
    const hover = () => (map.getCanvas().style.cursor = "grab");
    const leave = () => {
      if (!dragging) map.getCanvas().style.cursor = "crosshair";
    };
    for (const id of ["wg-vertex", "wg-mid"]) {
      map.on("mousedown", id, start);
      map.on("touchstart", id, start);
      map.on("mouseenter", id, hover);
      map.on("mouseleave", id, leave);
    }
    map.on("contextmenu", "wg-vertex", remove);
    map.on("dblclick", "wg-vertex", remove);
    return () => {
      end();
      if (!mapAlive(map)) return;
      for (const id of ["wg-vertex", "wg-mid"]) {
        map.off("mousedown", id, start);
        map.off("touchstart", id, start);
        map.off("mouseenter", id, hover);
        map.off("mouseleave", id, leave);
      }
      map.off("contextmenu", "wg-vertex", remove);
      map.off("dblclick", "wg-vertex", remove);
    };
  }, [map, setDraft]);
  return null;
}
