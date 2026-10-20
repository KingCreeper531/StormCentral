"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import type { StormCell } from "@/lib/feeds/storm-cells";
import { useT } from "@/lib/i18n/use-t";
import { PRO_PRODUCTS } from "@/lib/pro/products";
import { decodedValueAt } from "@/lib/pro/nexrad/client";
import { formatDecoded, scaleForTiles } from "@/lib/pro/scales";
import { frameAt, syncTime } from "@/lib/pro/sync";
import type { RadarFrame } from "@/lib/radar/frames";
import type { BufferStatus } from "@/lib/radar/layer-manager";
import { FAMILIES, legendGradient } from "@/lib/radar/products";
import type { PaneConfig, ProTool } from "@/store/pro-store";
import { cn } from "@/lib/utils";
import { MapView } from "../map/map-view";
import { StormCellsLayer } from "../map/layers/storm-cells-layer";
import { UserMarker } from "../map/layers/user-marker";
import { WarningsLayer } from "../map/layers/warnings-layer";
import { EMPTY_FEED, FrameSource, type PaneFeed } from "./frame-sources";
import { CameraSync, CursorSync, ProFrames, ToolClicks, ToolOverlay, type ToolShapes } from "./pane-layers";
import { PaneHeader } from "./pane-header";
import { usePro } from "./pro-context";
import { WarnGenOverlay } from "./warngen-overlay";
import type { ProCaps } from "./use-pro-caps";

interface Props {
  config: PaneConfig;
  /** 1-based position, shown as "P1". */
  n: number;
  site: string;
  frameCount: number;
  /** This pane is the loop's time basis. */
  basis: boolean;
  tool: ProTool;
  alerts: WeatherAlert[];
  selectedAlert: string | null;
  cells: StormCell[];
  shapes: ToolShapes;
  home: { lat: number; lon: number };
  compact: boolean;
  caps: ProCaps;
  onBasisFeed: (frames: RadarFrame[]) => void;
  onBasisStatus: (s: BufferStatus) => void;
  /** Move this panel to a window of its own. */
  onPopOut?: () => void;
}

/**
 * One panel of the workspace: its own MapLibre map, kept in lock-step with
 * the others through the sync bus (camera, loop clock, cursor).
 */
export const Pane = memo(function Pane({ config, n, site, frameCount, basis, tool, alerts, selectedAlert, cells, shapes, home, compact, caps, onBasisFeed, onBasisStatus, onPopOut }: Props) {
  const t = useT();
  const { probes, tools, sync } = usePro();
  const [feed, setFeed] = useState<PaneFeed>(EMPTY_FEED);
  const crosshair = useRef<HTMLDivElement>(null);
  const map = useRef<{ getZoom(): number } | null>(null);
  const def = PRO_PRODUCTS[config.product];

  const onFeed = useCallback((f: PaneFeed) => setFeed(f), []);

  // The basis pane's frames are the loop's timeline.
  useEffect(() => {
    if (basis) onBasisFeed(feed.frames);
  }, [basis, feed.frames, onBasisFeed]);

  // Register with the cursor readout.
  const label = `P${n} ${def.short}${feed.tilt ? ` ${feed.tilt.angle}°` : ""}`;
  useEffect(() => {
    const { frames, family, scale: feedScale, decoded } = feed;
    const times = frames.map((f) => f.time);
    probes.set(config.id, {
      label,
      family,
      frame: () => frames[frameAt(times, syncTime(sync.getState()))] ?? null,
      zoom: () => map.current?.getZoom() ?? 6,
      scale: (frame) => feedScale ?? scaleForTiles(frame.tileUrl, family),
      // Decoded radar: the exact gate value.
      exact:
        decoded && feedScale
          ? (frame, lat, lon) => {
              const r = decodedValueAt(frame.id, lat, lon);
              if (!r) return null;
              if (r.special) return r.special;
              return r.value == null ? "" : formatDecoded(feedScale, r.value, t);
            }
          : undefined,
    });
    return () => {
      probes.delete(config.id);
    };
  }, [probes, config.id, label, feed, sync, t]);

  const crisp = feed.decoded || (def.kind === "site" && FAMILIES[def.family].crisp);
  // The colour bar for whatever drew the frames (NOAA and IEM tiles use different ramps).
  const firstUrl = feed.frames[0]?.tileUrl;
  const scale = feed.scale ?? (firstUrl ? scaleForTiles(firstUrl, feed.family) : null);
  const selectAlert = useCallback((id: string) => tools.selectAlert(id), [tools]);

  return (
    <div className="relative min-h-0 min-w-0 overflow-hidden bg-canvas">
      <FrameSource product={config.product} site={config.site ?? site} tilt={config.tilt} elev={config.elev} frameCount={frameCount} basis={basis} caps={caps} onFeed={onFeed} />
      <MapView center={home} zoom={6.2} follow={false} onReady={(m) => (map.current = m)}>
        <CameraSync paneId={config.id} />
        <CursorSync paneId={config.id} crosshair={crosshair} />
        <ProFrames frames={feed.frames} opacity={config.opacity} crisp={crisp} onStatus={basis ? onBasisStatus : undefined} />
        {config.warnings && <WarningsLayer alerts={alerts} selectedId={selectedAlert} onSelect={selectAlert} />}
        {config.cells && <StormCellsLayer cells={cells} selectedId={null} onSelect={() => {}} />}
        <ToolOverlay shapes={shapes} />
        {tool === "warngen" && <WarnGenOverlay />}
        <ToolClicks tool={tool} />
        <UserMarker lat={home.lat} lon={home.lon} />
      </MapView>
      {/* Where the pointer is in another pane. */}
      <div ref={crosshair} aria-hidden className="pointer-events-none absolute top-0 left-0 z-[5] hidden">
        <div className="absolute -top-3 left-[-0.5px] h-6 w-px bg-white mix-blend-difference" />
        <div className="absolute -left-3 top-[-0.5px] h-px w-6 bg-white mix-blend-difference" />
      </div>
      <PaneHeader config={config} n={n} feed={feed} basis={basis} compact={compact} volume={caps.volume} onPopOut={onPopOut} />
      {scale && scale.stops.length > 1 && (
        <div className="pointer-events-none absolute bottom-1.5 left-1.5 z-[5] w-36 rounded-[4px] bg-canvas/80 px-1.5 py-1 font-mono text-[9px] text-ink-2 backdrop-blur-sm">
          <div className="h-1.5 rounded-[2px]" style={{ background: legendGradient(scale.stops) }} />
          <div className="mt-0.5 flex justify-between">
            <span>{scale.stops[0]!.value.toFixed(scale.decimals)}</span>
            <span>{scale.unit}</span>
            <span>{scale.stops.at(-1)!.value.toFixed(scale.decimals)}</span>
          </div>
        </div>
      )}
      {(feed.empty || (feed.loading && !feed.frames.length)) && (
        <div className={cn("pointer-events-none absolute inset-x-0 bottom-3 z-[5] text-center text-[11px]", feed.empty ? "text-caution" : "text-ink-3")}>
          {feed.note
            ? t(feed.note)
            : feed.missing
            ? t("{product} isn't available for {site} right now", { site: config.site ?? site, product: t(def.label) })
            : feed.empty
              ? t("{product}: no data right now", { product: t(def.label) })
              : t("Loading")}
        </div>
      )}
    </div>
  );
});
