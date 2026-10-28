"use client";

import type { FeatureCollection } from "geojson";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import type { TdsMark } from "@/lib/pro/nexrad/derive";
import { frameAt, syncTime } from "@/lib/pro/sync";
import type { RadarFrame } from "@/lib/radar/frames";
import { mapAlive, SLOTS, useMapContext } from "../map/map-view";
import { useGeoJsonLayers } from "../map/layers/use-geojson-source";
import { usePro } from "./pro-context";

const SRC = "pro-tds";
const ICON = "pro-tds-triangle";

/** A 16 px warning triangle (magenta, white edge, dark rim), drawn at 2×. */
function triangle(): ImageData | null {
  const ratio = 2;
  const size = 16 * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const path = (inset: number) => {
    g.beginPath();
    g.moveTo(size / 2, inset * 1.6);
    g.lineTo(size - inset, size - inset);
    g.lineTo(inset, size - inset);
    g.closePath();
  };
  g.fillStyle = "rgba(0,0,0,0.75)";
  path(0);
  g.fill();
  g.fillStyle = "#ffffff";
  path(2 * ratio * 0.6);
  g.fill();
  g.fillStyle = "#ff00d4";
  path(3.2 * ratio);
  g.fill();
  return g.getImageData(0, 0, size, size);
}

/**
 * Debris signatures (lib/pro/nexrad/tds.ts) of the frame on screen: a
 * triangle marked TDS at each one's centroid, and a card with its highest
 * PTDS, area, rotation and the tilts it shows on when the pointer is on it.
 */
export function TdsLayer({ frames, marks }: { frames: readonly RadarFrame[]; marks: ReadonlyMap<number, TdsMark[]> }) {
  const t = useT();
  const f = useFormat();
  const { map } = useMapContext();
  const { sync } = usePro();
  const [shown, setShown] = useState<TdsMark[]>([]);
  const [card, setCard] = useState<{ mark: TdsMark; x: number; y: number } | null>(null);

  // The marks of the frame the loop is on (stepping only re-renders when they change).
  useEffect(() => {
    const times = frames.map((x) => x.time);
    const apply = () => {
      const i = frameAt(times, syncTime(sync.getState()));
      const next = (i >= 0 && marks.get(times[i]!)) || [];
      setShown((prev) => (prev === next || (!prev.length && !next.length) ? prev : next));
    };
    apply();
    return sync.subscribe((s, prev) => {
      if (s.index !== prev.index || s.timeline !== prev.timeline) apply();
    });
  }, [frames, marks, sync]);

  useEffect(() => {
    if (!mapAlive(map) || map.hasImage(ICON)) return;
    const img = triangle();
    if (img) map.addImage(ICON, img, { pixelRatio: 2 });
  }, [map]);

  const data = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: shown.map((m, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: [m.lon, m.lat] }, properties: { i, label: "TDS" } })),
    }),
    [shown],
  );
  useGeoJsonLayers(
    SRC,
    data,
    (font) => [
      {
        id: "pro-tds-icon",
        type: "symbol",
        source: SRC,
        layout: {
          "icon-image": ICON,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["get", "label"],
          "text-font": font,
          "text-size": 11,
          "text-offset": [0, 1.3],
          "text-anchor": "top",
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.5 },
      },
    ],
    SLOTS.cells,
  );

  // The card: on hover, or on a tap.
  useEffect(() => {
    if (!map) return;
    const open = (e: MapLayerMouseEvent) => {
      const i = e.features?.[0]?.properties?.i;
      const mark = typeof i === "number" ? shown[i] : undefined;
      if (!mark) return;
      const p = map.project([mark.lon, mark.lat]);
      setCard({ mark, x: p.x, y: p.y });
      map.getCanvas().style.cursor = "pointer";
    };
    const close = () => {
      setCard(null);
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", "pro-tds-icon", open);
    map.on("click", "pro-tds-icon", open);
    map.on("mouseleave", "pro-tds-icon", close);
    map.on("move", close);
    return () => {
      if (!mapAlive(map)) return;
      map.off("mouseenter", "pro-tds-icon", open);
      map.off("click", "pro-tds-icon", open);
      map.off("mouseleave", "pro-tds-icon", close);
      map.off("move", close);
    };
  }, [map, shown]);

  if (!card) return null;
  const m = card.mark;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-52 -translate-x-1/2 rounded-[var(--radius-control)] border border-line bg-surface-1/95 p-2 text-[11px] text-ink-2 shadow-xl backdrop-blur-sm"
      style={{ left: card.x, top: card.y + 22 }}
    >
      <div className="mb-1 font-semibold text-ink">{t("Tornado debris signature")}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono tabular-nums">
        <dt className="font-sans text-ink-3">{t("Max PTDS")}</dt>
        <dd>{Math.round(m.maxPtds)} %</dd>
        <dt className="font-sans text-ink-3">{t("Area")}</dt>
        <dd>{f.units.distance === "mi" ? `${(m.areaKm2 * 0.386102).toFixed(2)} mi²` : `${m.areaKm2.toFixed(2)} km²`}</dd>
        <dt className="font-sans text-ink-3">NROT</dt>
        <dd>{m.nrot.toFixed(1)}</dd>
        <dt className="font-sans text-ink-3">{t("Tilts")}</dt>
        <dd>{m.tilts.map((a) => `${a.toFixed(1)}°`).join(", ")}</dd>
      </dl>
      <p className="mt-1 text-[10px] text-ink-3">{t("Debris in the air: a tornado has done damage here. It doesn't prove one is on the ground now.")}</p>
    </div>
  );
}
