"use client";

import { useQuery } from "@tanstack/react-query";
import type { AddLayerObject, GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from "maplibre-gl";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useT } from "@/lib/i18n/use-t";
import { parseGis, type GisData, type IconFile } from "@/lib/gis";
import { fetchIconSheet, fetchLayerText } from "@/lib/gis/load";
import { clearBlackBackground, iconCell, iconFrame, iconImages, minzoomBuckets, prepareFeatures } from "@/lib/gis/render";
import { drawSymbol, SYMBOL_RATIO } from "@/lib/gis/symbol-art";
import { isSymbol, symbolOf } from "@/lib/gis/symbols";
import { useAppStore } from "@/store/app-store";
import { gisFileText, useGisStore, type GisLayerConfig } from "@/store/gis-store";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { useLayerClick } from "./use-layer-click";

/** Links are re-read this often unless the placefile asks otherwise (never faster than every 30 s). */
const DEFAULT_REFRESH_S = 300;
const MIN_REFRESH_S = 30;

/** A layer's parsed data, shared by every map showing it and by the layer list. */
export function useGisData(config: GisLayerConfig) {
  return useQuery<GisData>({
    queryKey: ["gis", config.id, config.url, config.format],
    queryFn: async ({ signal }) => {
      const text = config.url ? await fetchLayerText(config.url, signal) : gisFileText(config.id);
      if (text == null) throw new Error("The file is no longer on this device");
      return parseGis(text, config.format, config.url ?? undefined);
    },
    refetchInterval: (q) => (config.url ? Math.max(MIN_REFRESH_S, q.state.data?.refreshSec ?? DEFAULT_REFRESH_S) * 1000 : false),
    staleTime: 15_000,
    retry: 1,
  });
}

/** Icon sheets, decoded once per link for every map. */
const sheets = new Map<string, Promise<ImageBitmap | null>>();
const loadSheet = (url: string) => {
  if (!sheets.has(url)) sheets.set(url, fetchIconSheet(url).catch(() => null));
  return sheets.get(url)!;
};

/** One icon cut from its sheet, hotspot and offset at the image's centre; null when the sheet has no such cell. */
function cutIcon(sheet: ImageBitmap, file: IconFile, n: number, dx: number, dy: number): ImageData | null {
  const cell = iconCell(sheet.width, sheet.height, file.w, file.h, n);
  if (!cell) return null;
  const icon = new OffscreenCanvas(file.w, file.h).getContext("2d", { willReadFrequently: true });
  if (!icon) return null;
  icon.drawImage(sheet, cell.x, cell.y, file.w, file.h, 0, 0, file.w, file.h);
  const px = icon.getImageData(0, 0, file.w, file.h);
  clearBlackBackground(px.data);
  const f = iconFrame(file.w, file.h, file.hotX, file.hotY, dx, dy);
  const out = new OffscreenCanvas(f.width, f.height).getContext("2d");
  if (!out) return null;
  out.putImageData(px, f.x, f.y);
  return out.getImageData(0, 0, f.width, f.height);
}

/** Adds every icon image a layer uses: symbols, cells of its sheets, and a pin for any that can't be read. */
async function registerIcons(map: MlMap, layerId: string, data: GisData) {
  for (const img of iconImages(layerId, data)) {
    if (!mapAlive(map)) return;
    if (map.hasImage(img.id)) continue;
    let pixels: ImageData | null = null;
    let pixelRatio = 1;
    if (!isSymbol(img.icon)) {
      const [fileN, n] = img.icon.split("-").map(Number);
      const file = data.iconFiles.find((f) => f.n === fileN);
      const sheet = file ? await loadSheet(file.url) : null;
      if (!mapAlive(map)) return;
      if (map.hasImage(img.id)) continue;
      pixels = sheet && file ? cutIcon(sheet, file, n!, img.dx, img.dy) : null;
    }
    if (!pixels) {
      pixels = drawSymbol(isSymbol(img.icon) ? symbolOf(img.icon) : "pin");
      pixelRatio = SYMBOL_RATIO;
    }
    if (pixels) map.addImage(img.id, pixels, { pixelRatio });
  }
}

function specs(src: string, buckets: number[], opacity: number, font: string[]): { spec: AddLayerObject; before: string }[] {
  const out: { spec: AddLayerObject; before: string }[] = [];
  for (const mz of buckets) {
    const is = (kind: string) => ["all", ["==", ["get", "kind"], kind], ["==", ["get", "mz"], mz]] as never;
    const id = `${src}-${mz}`;
    out.push(
      {
        spec: { id: `${id}-fill`, type: "fill", source: src, minzoom: mz, filter: is("fill"), paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", ["get", "opacity"], opacity] } },
        before: SLOTS.warnings,
      },
      {
        spec: {
          id: `${id}-line`,
          type: "line",
          source: src,
          minzoom: mz,
          filter: is("line"),
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": ["*", ["get", "opacity"], opacity] },
        },
        before: SLOTS.cells,
      },
      {
        spec: {
          id: `${id}-point`,
          type: "circle",
          source: src,
          minzoom: mz,
          filter: is("point"),
          paint: { "circle-color": ["get", "color"], "circle-radius": 5, "circle-stroke-color": "#000000", "circle-stroke-width": 1.2, "circle-opacity": opacity, "circle-stroke-opacity": opacity },
        },
        before: SLOTS.cells,
      },
      {
        spec: {
          id: `${id}-icon`,
          type: "symbol",
          source: src,
          minzoom: mz,
          filter: is("icon"),
          layout: {
            "icon-image": ["get", "image"],
            "icon-rotate": ["get", "rotate"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": opacity },
        },
        before: SLOTS.cells,
      },
      {
        spec: {
          id: `${id}-text`,
          type: "symbol",
          source: src,
          minzoom: mz,
          filter: is("text"),
          layout: {
            "text-field": ["get", "text"],
            "text-font": font,
            "text-size": ["get", "size"],
            "text-anchor": ["get", "anchor"],
            "text-radial-offset": ["get", "radial"],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "text-color": ["get", "color"], "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.3, "text-opacity": opacity },
        },
        before: SLOTS.cells,
      },
    );
  }
  return out;
}

function GisLayer({ config, onPick }: { config: GisLayerConfig; onPick: (e: MapLayerMouseEvent, name: string) => void }) {
  const { map, font } = useMapContext();
  const { data } = useGisData(config);
  const src = `gis-${config.id}`;
  const buckets = useMemo(() => (data ? minzoomBuckets(data) : []), [data]);
  const bucketKey = buckets.join(",");
  const fontKey = font.join(",");

  // Source and layers: rebuilt when the zoom buckets, opacity or font change.
  const ids = useMemo(() => specs(src, bucketKey ? bucketKey.split(",").map(Number) : [], config.opacity, fontKey.split(",")), [src, bucketKey, config.opacity, fontKey]);
  useEffect(() => {
    if (!mapAlive(map) || !ids.length) return;
    if (!map.getSource(src)) map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    for (const { spec, before } of ids) {
      try {
        map.addLayer(spec, map.getLayer(before) ? before : undefined);
      } catch (err) {
        console.warn("[gis] layer skipped:", spec.id, err);
      }
    }
    return () => {
      if (!mapAlive(map)) return;
      for (const { spec } of ids) if (map.getLayer(spec.id)) map.removeLayer(spec.id);
    };
  }, [map, src, ids]);

  // Data, and the icons it uses.
  useEffect(() => {
    if (!mapAlive(map) || !data) return;
    void registerIcons(map, config.id, data).then(() => {
      if (mapAlive(map)) (map.getSource(src) as GeoJSONSource | undefined)?.setData(prepareFeatures(config.id, data));
    });
  }, [map, data, src, config.id, ids]);

  // The source goes with the component.
  useEffect(
    () => () => {
      if (mapAlive(map) && map.getSource(src)) {
        for (const l of map.getStyle().layers) if ("source" in l && l.source === src) map.removeLayer(l.id);
        map.removeSource(src);
      }
    },
    [map, src],
  );

  useLayerClick(
    ids.map((x) => x.spec.id),
    (e) => onPick(e, data?.title ?? config.name),
  );
  return null;
}

/**
 * Custom layers on the map: every enabled placefile, KML and GeoJSON layer
 * (store/gis-store), above the radar. Clicking an item with hover text shows
 * it in a small card. Looking back at the radar archive, only files show:
 * live feeds (chasers now) would sit on a storm from another day.
 */
export function GisLayers() {
  const t = useT();
  const { map } = useMapContext();
  const archived = useAppStore((s) => s.archiveAt != null);
  const layers = useGisStore(useShallow((s) => s.layers.filter((l) => l.enabled && !(archived && l.url))));
  const [info, setInfo] = useState<{ title: string; text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!mapAlive(map)) return;
    // A click on an item stops here first (its handler calls preventDefault); anywhere else closes the card.
    const close = (e: MapLayerMouseEvent) => {
      if (!e.defaultPrevented) setInfo(null);
    };
    const moved = () => setInfo(null);
    map.on("click", close);
    map.on("movestart", moved);
    return () => {
      if (!mapAlive(map)) return;
      map.off("click", close);
      map.off("movestart", moved);
    };
  }, [map]);

  const pick = (e: MapLayerMouseEvent, title: string) => {
    const hover = e.features?.find((f) => typeof f.properties?.hover === "string")?.properties?.hover as string | undefined;
    if (!hover) return;
    e.preventDefault();
    setInfo({ title, text: hover, x: e.point.x, y: e.point.y });
  };

  return (
    <>
      {layers.map((l) => (
        <GisLayer key={l.id} config={l} onPick={pick} />
      ))}
      {info && (
        <div
          role="dialog"
          aria-label={info.title}
          className="absolute z-30 max-w-[17rem] rounded-[var(--radius-control)] border border-line-strong bg-surface-1 p-2.5 text-[12px] shadow-xl"
          style={{ left: Math.max(8, info.x + 10), top: Math.max(8, info.y + 10) }}
        >
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[11px] font-semibold text-ink-3">{info.title}</p>
            <button type="button" aria-label={t("Close")} onClick={() => setInfo(null)} className="-mt-0.5 -mr-0.5 text-ink-3 hover:text-ink">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          <p className="mt-1 whitespace-pre-line text-ink">{info.text}</p>
        </div>
      )}
    </>
  );
}
