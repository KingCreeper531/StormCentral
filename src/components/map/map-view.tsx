"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { AttributionControl, getVersion, Map as MlMap, NavigationControl, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BBox } from "@/lib/geo";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Z-order slots. Our layers insert *before* a slot marker, so stacking is
 * deterministic no matter which layer component mounts first. Data layers sit
 * beneath the basemap's labels (place names stay readable over radar);
 * interactive markers sit on top of everything.
 */
export const SLOTS = {
  satellite: "slot-satellite",
  outlook: "slot-outlook",
  heat: "slot-heat",
  radar: "slot-radar",
  tropical: "slot-tropical",
  warnings: "slot-warnings",
  tracks: "slot-tracks",
  sites: "slot-sites",
  cells: "slot-cells",
  stormReports: "slot-storm-reports",
  reports: "slot-reports",
} as const;
const BELOW_LABELS = [SLOTS.satellite, SLOTS.outlook, SLOTS.heat, SLOTS.radar, SLOTS.tropical, SLOTS.warnings] as const;
const ABOVE_LABELS = [SLOTS.tracks, SLOTS.sites, SLOTS.cells, SLOTS.stormReports, SLOTS.reports] as const;

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const styleUrl = (theme: Theme) =>
  MAPTILER_KEY
    ? `https://api.maptiler.com/maps/dataviz-${theme}/style.json?key=${MAPTILER_KEY}`
    : `https://basemaps.cartocdn.com/gl/${theme === "light" ? "positron" : "dark-matter"}-gl-style/style.json`;

interface MapCtx {
  map: MlMap | null;
  /** A text-font stack that exists on the basemap's glyph server. */
  font: string[];
}

const Ctx = createContext<MapCtx>({ map: null, font: [] });

/**
 * True while the map still has a style. React may run the MapView's cleanup
 * (map.remove()) before its children's, so layer cleanups must check this.
 */
export const mapAlive = (map: MlMap | null): map is MlMap => !!map && !!(map as unknown as { style?: unknown }).style;
export const useMapContext = () => useContext(Ctx);

let workerConfigured = false;

/**
 * MapLibre needs WebGL 2. Some machines don't have it (blocklisted GPU drivers,
 * VMs, remote desktop sessions) and the map constructor throws there, so probe
 * once and show a notice instead of taking the whole page down.
 */
let webgl2: boolean | undefined;
function hasWebGL2() {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      webgl2 = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext(); // release the probe's context
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}
const noSubscribe = () => () => {};

interface Props {
  center: { lat: number; lon: number };
  zoom?: number;
  interactive?: boolean;
  /** Re-centre when `center` changes (otherwise only the initial centre is used). */
  follow?: boolean;
  className?: string;
  children?: React.ReactNode;
  onViewChange?: (bbox: BBox, zoom: number) => void;
  onReady?: (map: MlMap) => void;
}

export function MapView({ center, zoom = 6.5, interactive = true, follow = true, className, children, onViewChange, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<MapCtx>({ map: null, font: [] });
  const supported = useSyncExternalStore(noSubscribe, hasWebGL2, () => true);
  // A theme switch rebuilds the map on the matching basemap; layers re-add themselves.
  const theme = useResolvedTheme();
  const viewCb = useRef(onViewChange);
  const readyCb = useRef(onReady);
  useEffect(() => {
    viewCb.current = onViewChange;
    readyCb.current = onReady;
  });

  useEffect(() => {
    if (!container.current || !supported) return;
    if (!workerConfigured) {
      // MapLibre v6 resolves its worker relative to import.meta.url, which
      // bundlers rewrite; serve the vendored copy instead (see scripts/).
      setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${getVersion()}`);
      workerConfigured = true;
    }
    let map: MlMap;
    try {
      map = new MlMap({
        container: container.current,
        style: styleUrl(theme),
        center: [center.lon, center.lat],
        zoom,
        interactive,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false,
        maxPitch: 0,
        // Bounded per-source tile cache: with one source per radar frame this is
        // what keeps GPU memory flat during long loops.
        maxTileCacheSize: 48,
        fadeDuration: 0,
        cancelPendingTileRequestsWhileZooming: true,
      });
    } catch (err) {
      // The probe passed but context creation still failed (e.g. GPU process crash).
      console.error("[map] could not start:", err);
      return;
    }
    // Attribution is always the compact (i) button. A non-interactive preview
    // runs its own transport along the bottom edge, so its button sits top-right.
    // Added before the zoom buttons so those stack above it.
    map.addControl(new AttributionControl({ compact: true }), interactive ? "bottom-right" : "top-right");
    // Zoom buttons are for mouse users; touch devices pinch, and on phones the
    // control would only collide with the bottom sheet and tab bar.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (interactive && !coarse) map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");

    // MapLibre switches the control to compact mode, expanded, the first time an
    // attributed source appears. For the basemap that can be before 'load'; for
    // the radar it's well after. Collapse it at that moment (one time only), so
    // it never covers overlays. Later taps on the (i) button are left alone.
    const attrib = map.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
    let attribWatch: MutationObserver | null = null;
    const collapseAttrib = () => {
      if (!attrib?.classList.contains("maplibregl-compact")) return false;
      attrib.classList.remove("maplibregl-compact-show");
      return true;
    };
    if (attrib && !collapseAttrib()) {
      attribWatch = new MutationObserver(() => {
        if (collapseAttrib()) attribWatch?.disconnect();
      });
      attribWatch.observe(attrib, { attributes: true, attributeFilter: ["class"] });
    }

    const emitView = () => {
      const b = map.getBounds();
      viewCb.current?.({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, map.getZoom());
    };

    map.on("load", () => {
      const style = map.getStyle() as StyleSpecification;
      // OLED pass (dark theme): pull the basemap's background and water to near-black.
      for (const layer of theme === "dark" ? style.layers : []) {
        if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", "#030406");
        else if (layer.type === "fill" && /water|ocean|lake/i.test(layer.id)) map.setPaintProperty(layer.id, "fill-color", "#070b12");
      }
      const firstSymbol = style.layers.find((l) => l.type === "symbol");
      const fontLayer = style.layers.find((l) => l.type === "symbol" && Array.isArray((l.layout as Record<string, unknown> | undefined)?.["text-font"]));
      const font = ((fontLayer?.layout as Record<string, unknown> | undefined)?.["text-font"] as string[] | undefined) ?? ["Open Sans Regular"];
      const marker = (id: string) => ({ id, type: "background" as const, layout: { visibility: "none" as const }, paint: { "background-opacity": 0 } });
      for (const id of BELOW_LABELS) map.addLayer(marker(id), firstSymbol?.id);
      for (const id of ABOVE_LABELS) map.addLayer(marker(id));
      setCtx({ map, font });
      readyCb.current?.(map);
      emitView();
    });
    map.on("moveend", emitView);
    map.on("resize", emitView);

    return () => {
      attribWatch?.disconnect();
      setCtx({ map: null, font: [] });
      map.remove();
    };
    // The map is created once; centre/zoom changes are applied imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, supported, theme]);

  useEffect(() => {
    const map = ctx.map;
    if (!map || !follow) return;
    const c = map.getCenter();
    if (Math.abs(c.lat - center.lat) < 1e-4 && Math.abs(c.lng - center.lon) < 1e-4) return;
    map.flyTo({ center: [center.lon, center.lat], zoom: Math.max(map.getZoom(), zoom), speed: 1.4, essential: true });
  }, [ctx.map, center.lat, center.lon, follow, zoom]);

  return (
    <Ctx.Provider value={ctx}>
      {/* MapLibre forces `position: relative` on its container, so size it via a wrapper. */}
      <div className={cn("absolute inset-0", className)}>
        <div ref={container} className="h-full w-full" />
        {!supported && (
          <p className="absolute inset-0 grid place-items-center p-4 text-center text-[13px] text-ink-3">
            The map needs WebGL 2, which isn&apos;t available on this device. Forecasts and warnings still work.
          </p>
        )}
      </div>
      {ctx.map && children}
    </Ctx.Provider>
  );
}
