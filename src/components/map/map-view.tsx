"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { AttributionControl, getVersion, Map as MlMap, NavigationControl, setWorkerUrl, type PaddingOptions, type StyleSpecification } from "maplibre-gl";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BBox } from "@/lib/geo";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { useT } from "@/lib/i18n/use-t";
import { basemapUrl, isDarkBasemap, MAX_PITCH, resolveBasemap, START_PITCH, type BaseLayer } from "@/lib/map/style";
import { cn } from "@/lib/utils";
import { useMapStyleStore } from "@/store/map-style-store";
import { BasemapStyle } from "./basemap-style";
import { PluginLayers } from "./layers/plugin-layers";

/**
 * Z-order slots. Our layers insert *before* a slot marker, so stacking is
 * deterministic no matter which layer component mounts first. Data layers sit
 * beneath the basemap's labels (place names stay readable over radar);
 * interactive markers sit on top of everything.
 */
export const SLOTS = {
  /** Plugin imagery that stands in for the basemap, under the GOES clouds. */
  base: "slot-base",
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
const BELOW_LABELS = [SLOTS.base, SLOTS.satellite, SLOTS.outlook, SLOTS.heat, SLOTS.radar, SLOTS.tropical, SLOTS.warnings] as const;
const ABOVE_LABELS = [SLOTS.tracks, SLOTS.sites, SLOTS.cells, SLOTS.stormReports, SLOTS.reports] as const;

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

interface MapCtx {
  map: MlMap | null;
  /** A text-font stack that exists on the basemap's glyph server. */
  font: string[];
  /** The basemap style's own layers (everything that was there before ours). */
  basemap: ReadonlySet<string>;
  /** Those layers as the style was loaded, before any restyling (lib/map/style). */
  baseLayers: readonly BaseLayer[];
  /** The dark basemap is on screen. */
  dark: boolean;
  /** The satellite map stands in for the basemap's area fills (set by SatelliteMapLayer). */
  satellite: boolean;
  setSatellite: (on: boolean) => void;
}

type LoadedMap = Pick<MapCtx, "map" | "font" | "basemap" | "baseLayers" | "dark">;
const NO_LAYERS: ReadonlySet<string> = new Set();
const UNLOADED: LoadedMap = { map: null, font: [], basemap: NO_LAYERS, baseLayers: [], dark: true };
const Ctx = createContext<MapCtx>({ ...UNLOADED, satellite: false, setSatellite: () => {} });

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
  /** The map may tilt for 3D terrain when the map style asks for it. */
  allow3d?: boolean;
  className?: string;
  children?: React.ReactNode;
  onViewChange?: (bbox: BBox, zoom: number) => void;
  onReady?: (map: MlMap) => void;
}

export function MapView({ center, zoom = 6.5, interactive = true, follow = true, allow3d = false, className, children, onViewChange, onReady }: Props) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<LoadedMap>(UNLOADED);
  const [satellite, setSatellite] = useState(false);
  const ctx = useMemo<MapCtx>(() => ({ ...loaded, satellite, setSatellite }), [loaded, satellite]);
  const supported = useSyncExternalStore(noSubscribe, hasWebGL2, () => true);
  // A theme or basemap switch rebuilds the map on the new style, keeping the view; layers re-add themselves.
  const theme = useResolvedTheme();
  const basemapId = resolveBasemap(useMapStyleStore((s) => s.style.basemap), theme);
  const viewCb = useRef(onViewChange);
  const readyCb = useRef(onReady);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    viewCb.current = onViewChange;
    readyCb.current = onReady;
    zoomRef.current = zoom;
  });
  /** The previous map's camera: a rebuilt map picks up where it was, not at the starting view. */
  const lastView = useRef<{ center: [number, number]; zoom: number; bearing: number; pitch: number; padding: PaddingOptions } | null>(null);
  /** The centre last flown to. Only a new one moves the map (not a zoom change, nor a rebuilt map). */
  const followed = useRef(center);

  useEffect(() => {
    if (!container.current || !supported) return;
    if (!workerConfigured) {
      // MapLibre v6 resolves its worker relative to import.meta.url, which
      // bundlers rewrite; serve the vendored copy instead (see scripts/).
      setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${getVersion()}`);
      workerConfigured = true;
    }
    const tilted = allow3d && interactive && useMapStyleStore.getState().style.terrain3d;
    const view = lastView.current;
    let map: MlMap;
    try {
      map = new MlMap({
        container: container.current,
        style: basemapUrl(basemapId, MAPTILER_KEY),
        center: view?.center ?? [center.lon, center.lat],
        zoom: view?.zoom ?? zoom,
        bearing: view?.bearing ?? 0,
        interactive,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false,
        // Flat unless 3D terrain is on (BasemapStyle unlocks tilting); starting tilted means
        // the first fly to the location keeps the tilt instead of cutting it short.
        ...(tilted ? { pitch: view?.pitch ?? START_PITCH, maxPitch: MAX_PITCH } : { maxPitch: 0 }),
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
    // The same padding as before keeps that centre at the same place on screen.
    if (view) map.setPadding(view.padding);
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
      const basemap = new Set(style.layers.map((l) => l.id));
      // Copied before anything restyles them (BasemapStyle works from these originals).
      const baseLayers = structuredClone(style.layers) as BaseLayer[];
      const firstSymbol = style.layers.find((l) => l.type === "symbol");
      const fontLayer = style.layers.find((l) => l.type === "symbol" && Array.isArray((l.layout as Record<string, unknown> | undefined)?.["text-font"]));
      const font = ((fontLayer?.layout as Record<string, unknown> | undefined)?.["text-font"] as string[] | undefined) ?? ["Open Sans Regular"];
      const marker = (id: string) => ({ id, type: "background" as const, layout: { visibility: "none" as const }, paint: { "background-opacity": 0 } });
      for (const id of BELOW_LABELS) map.addLayer(marker(id), firstSymbol?.id);
      for (const id of ABOVE_LABELS) map.addLayer(marker(id));
      setLoaded({ map, font, basemap, baseLayers, dark: isDarkBasemap(basemapId) });
      readyCb.current?.(map);
      emitView();
    });
    map.on("moveend", emitView);
    map.on("resize", emitView);

    return () => {
      attribWatch?.disconnect();
      const c = map.getCenter();
      lastView.current = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), padding: map.getPadding() };
      setLoaded(UNLOADED);
      setSatellite(false);
      map.remove();
    };
    // The map is created once per style; centre changes are applied imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, supported, basemapId]);

  useEffect(() => {
    const map = ctx.map;
    if (!map || !follow) return;
    if (followed.current.lat === center.lat && followed.current.lon === center.lon) return;
    followed.current = { lat: center.lat, lon: center.lon };
    map.flyTo({ center: [center.lon, center.lat], zoom: Math.max(map.getZoom(), zoomRef.current), speed: 1.4, essential: true });
  }, [ctx.map, center.lat, center.lon, follow]);

  return (
    <Ctx.Provider value={ctx}>
      {/* MapLibre forces `position: relative` on its container, so size it via a wrapper. */}
      <div className={cn("absolute inset-0", className)}>
        <div ref={container} className="h-full w-full" />
        {!supported && (
          <p className="absolute inset-0 grid place-items-center p-4 text-center text-[13px] text-ink-3">
            {t("The map needs WebGL 2, which isn't available on this device. Forecasts and warnings still work.")}
          </p>
        )}
      </div>
      {ctx.map && <BasemapStyle allow3d={allow3d && interactive} />}
      {ctx.map && children}
      {ctx.map && interactive && <PluginLayers />}
    </Ctx.Provider>
  );
}
