"use client";

import type { FeatureCollection } from "geojson";
import type { MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import { frameAt, sameCamera, syncTime } from "@/lib/pro/sync";
import { toaFan, type Motion } from "@/lib/pro/storm-tools";
import type { RadarFrame } from "@/lib/radar/frames";
import { RadarLayerManager, type BufferStatus, type RadarMap } from "@/lib/radar/layer-manager";
import type { LatLon } from "@/lib/geo";
import type { ProTool } from "@/store/pro-store";
import { mapAlive, SLOTS, useMapContext } from "../map/map-view";
import { useGeoJsonLayers } from "../map/layers/use-geojson-source";
import { usePro } from "./pro-context";

/**
 * A pane's raster loop: the shared frame pool (RadarLayerManager) driven by
 * the sync bus. The loop clock is subscribed to outside React, so stepping
 * frames is a paint-property flip per pane with no re-render.
 */
export function ProFrames({ frames, opacity, crisp, onStatus }: { frames: readonly RadarFrame[]; opacity: number; crisp: boolean; onStatus?: (s: BufferStatus) => void }) {
  const { map } = useMapContext();
  const { sync } = usePro();
  const mgr = useRef<RadarLayerManager | null>(null);
  const statusCb = useRef(onStatus);
  const lastStatus = useRef<BufferStatus | null>(null);
  useEffect(() => {
    statusCb.current = onStatus;
  });
  // The manager only reports changes: hand a newly attached listener (this pane just became the time basis) the current state.
  useEffect(() => {
    if (onStatus && lastStatus.current) onStatus(lastStatus.current);
  }, [onStatus]);

  useEffect(() => {
    if (!map) return;
    const m = new RadarLayerManager(map as unknown as RadarMap, {
      beforeId: () => SLOTS.radar,
      onStatus: (s) => {
        lastStatus.current = s;
        statusCb.current?.(s);
      },
    });
    mgr.current = m;
    return () => {
      if (mapAlive(map)) m.destroy();
      mgr.current = null;
      lastStatus.current = null;
    };
  }, [map]);

  useEffect(() => {
    const m = mgr.current;
    if (!m) return;
    m.sync(frames);
    const times = frames.map((f) => f.time);
    const apply = (t: number) => {
      const i = frameAt(times, t);
      if (i >= 0) m.show(i);
    };
    apply(syncTime(sync.getState()));
    return sync.subscribe((s, prev) => {
      if (s.index !== prev.index || s.timeline !== prev.timeline) apply(syncTime(s));
    });
  }, [frames, sync, map]);

  useEffect(() => mgr.current?.setOpacity(opacity), [opacity, map]);
  useEffect(() => mgr.current?.setCrisp(crisp), [crisp, map]);
  return null;
}

/**
 * Spatial sync. A gesture in this pane (a move event carrying the user's
 * input) is published with the pane's id; every other pane jumps to it. Jumps
 * carry no input event, so they're never re-published: no echo loops.
 */
export function CameraSync({ paneId }: { paneId: string }) {
  const { map } = useMapContext();
  const { sync } = usePro();
  useEffect(() => {
    if (!map) return;
    const c = sync.getState().camera;
    map.jumpTo({ center: [c.lng, c.lat], zoom: c.zoom });
    const onMove = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return;
      const ctr = map.getCenter();
      sync.setState({ camera: { lng: ctr.lng, lat: ctr.lat, zoom: map.getZoom(), source: paneId } });
    };
    map.on("move", onMove);
    const unsub = sync.subscribe((s, prev) => {
      if (s.camera === prev.camera || s.camera.source === paneId || !mapAlive(map)) return;
      const ctr = map.getCenter();
      if (sameCamera({ lng: ctr.lng, lat: ctr.lat, zoom: map.getZoom() }, s.camera)) return;
      map.jumpTo({ center: [s.camera.lng, s.camera.lat], zoom: s.camera.zoom });
    });
    return () => {
      unsub();
      if (mapAlive(map)) map.off("move", onMove);
    };
  }, [map, sync, paneId]);
  return null;
}

/**
 * Cursor sync: the pointer in one pane is broadcast (once per animation
 * frame) and drawn as a crosshair in all the others, positioned with a CSS
 * transform, no React involved.
 */
export function CursorSync({ paneId, crosshair }: { paneId: string; crosshair: React.RefObject<HTMLDivElement | null> }) {
  const { map } = useMapContext();
  const { sync } = usePro();
  useEffect(() => {
    if (!map) return;
    let raf = 0;
    let pending: LatLon | null = null;
    const publish = () => {
      raf = 0;
      if (pending) sync.setState({ cursor: { lng: pending.lon, lat: pending.lat, source: paneId } });
    };
    const onPointer = (e: MapMouseEvent) => {
      pending = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      raf ||= requestAnimationFrame(publish);
    };
    const onOut = () => {
      pending = null;
      if (sync.getState().cursor?.source === paneId) sync.setState({ cursor: null });
    };
    const place = () => {
      const el = crosshair.current;
      const c = sync.getState().cursor;
      if (!el) return;
      // The pane under the pointer shows the real cursor; the rest show where it is.
      if (!c || c.source === paneId) {
        el.style.display = "none";
        return;
      }
      const p = map.project([c.lng, c.lat]);
      el.style.display = "block";
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    };
    map.on("mousemove", onPointer);
    map.on("click", onPointer);
    map.on("mouseout", onOut);
    map.on("move", place);
    const unsub = sync.subscribe((s, prev) => {
      if (s.cursor !== prev.cursor) place();
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsub();
      if (!mapAlive(map)) return;
      map.off("mousemove", onPointer);
      map.off("click", onPointer);
      map.off("mouseout", onOut);
      map.off("move", place);
    };
  }, [map, sync, paneId, crosshair]);
  return null;
}

/** Routes map clicks to the active analysis tool. */
export function ToolClicks({ tool }: { tool: ProTool }) {
  const { map } = useMapContext();
  const { tools } = usePro();
  const ref = useRef({ tool, tools });
  useEffect(() => {
    ref.current = { tool, tools };
  });
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      const { tool: active, tools: act } = ref.current;
      if (active === "sounding") act.sounding(p);
      else if (active === "xsect") act.xsect(p);
      else if (active === "vector") act.vector(p);
      else if (active === "toa") act.toa(p);
    };
    map.on("click", onClick);
    return () => {
      if (mapAlive(map)) map.off("click", onClick);
    };
  }, [map]);
  useEffect(() => {
    if (map) map.getCanvas().style.cursor = tool === "inspect" ? "" : "crosshair";
  }, [map, tool]);
  return null;
}

export interface ToolShapes {
  sounding: LatLon | null;
  xsect: { a: LatLon; b: LatLon | null } | null;
  vector: { a: LatLon; b: LatLon | null } | null;
  motion: Motion | null;
  toaPoints: (LatLon & { name: string })[];
  showFan: boolean;
}

const SRC = "pro-tools";

/** Everything the analysis tools draw: the A–A′ line, the storm vector, the TOA fan and its points. */
export function ToolOverlay({ shapes }: { shapes: ToolShapes }) {
  const data = useMemo<FeatureCollection>(() => {
    const f: FeatureCollection["features"] = [];
    const pt = (p: LatLon, label: string, kind: string) =>
      f.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { label, kind } });
    if (shapes.motion && shapes.showFan) {
      const fan = toaFan(shapes.motion);
      f.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [fan.ring] }, properties: { kind: "fan" } });
      for (const arc of fan.arcs) {
        f.push({ type: "Feature", geometry: { type: "LineString", coordinates: arc.coords }, properties: { kind: "arc" } });
        pt(arc.label, `${arc.minutes}m`, "arc-label");
      }
      f.push({ type: "Feature", geometry: { type: "LineString", coordinates: fan.axis }, properties: { kind: "axis" } });
    }
    if (shapes.vector) {
      pt(shapes.vector.a, "1", "vec");
      if (shapes.vector.b) {
        pt(shapes.vector.b, "2", "vec");
        f.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[shapes.vector.a.lon, shapes.vector.a.lat], [shapes.vector.b.lon, shapes.vector.b.lat]] }, properties: { kind: "vector" } });
      }
    }
    if (shapes.xsect) {
      pt(shapes.xsect.a, "A", "xs");
      if (shapes.xsect.b) {
        pt(shapes.xsect.b, "A′", "xs");
        f.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[shapes.xsect.a.lon, shapes.xsect.a.lat], [shapes.xsect.b.lon, shapes.xsect.b.lat]] }, properties: { kind: "xsect" } });
      }
    }
    if (shapes.sounding) pt(shapes.sounding, "", "snd");
    for (const p of shapes.toaPoints) pt(p, p.name, "poi");
    return { type: "FeatureCollection", features: f };
  }, [shapes]);

  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      { id: "pro-fan", type: "fill", source: SRC, filter: ["==", ["get", "kind"], "fan"], paint: { "fill-color": "#facc15", "fill-opacity": 0.12 } },
      {
        id: "pro-lines",
        type: "line",
        source: SRC,
        filter: ["match", ["get", "kind"], ["arc", "axis", "vector", "xsect"], true, false],
        paint: {
          "line-color": ["match", ["get", "kind"], "xsect", "#38bdf8", "vector", "#f472b6", "#facc15"],
          "line-width": ["match", ["get", "kind"], "axis", 1.2, 2],
          "line-dasharray": ["match", ["get", "kind"], "axis", ["literal", [2, 2]], ["literal", [1, 0]]],
        },
      },
      {
        id: "pro-points",
        type: "circle",
        source: SRC,
        filter: ["match", ["get", "kind"], ["vec", "xs", "snd", "poi"], true, false],
        paint: {
          "circle-radius": ["match", ["get", "kind"], "snd", 6, 4.5],
          "circle-color": ["match", ["get", "kind"], "xs", "#38bdf8", "vec", "#f472b6", "snd", "#a3e635", "#facc15"],
          "circle-stroke-color": "#000",
          "circle-stroke-width": 1.5,
        },
      },
      {
        id: "pro-labels",
        type: "symbol",
        source: SRC,
        filter: ["!=", ["get", "label"], ""],
        layout: { "text-field": ["get", "label"], "text-font": font, "text-size": 12, "text-offset": [0, -1.1], "text-allow-overlap": true },
        paint: { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1.5 },
      },
    ],
    SLOTS.tracks,
  );
  return null;
}
