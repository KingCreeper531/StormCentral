"use client";

import { Maximize2 } from "lucide-react";
import { useNationalAlerts } from "@/hooks/queries";
import { useRadarLoop } from "@/hooks/use-radar-loop";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { MapView } from "../map/map-view";
import { RadarLayer } from "../map/layers/radar-layer";
import { UserMarker } from "../map/layers/user-marker";
import { WarningsLayer } from "../map/layers/warnings-layer";
import { RadarTimeline } from "../radar/radar-timeline";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";

/** Compact national-mosaic loop; opens the full radar (Radar mode). */
export function RadarPreview({ now, timeZone, className }: { now: number; timeZone?: string; className?: string }) {
  const loc = useAppStore((s) => s.location);
  const setMode = useAppStore((s) => s.setMode);
  const alerts = useNationalAlerts(true);
  const loop = useRadarLoop({ site: null, product: "N0Q", frameCount: 10, speed: 1, crossfade: true });

  return (
    <Panel padded={false} aria-label="Radar preview" className={cn("flex flex-col", className)}>
      {/* Same padding and header spacing as <Panel>, so titles in a shared grid row align. */}
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5 sm:pt-5 sm:pb-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">Radar</h2>
          <p className="mt-0.5 truncate text-xs text-ink-3">NEXRAD national mosaic</p>
        </div>
        <Button size="sm" onClick={() => setMode("severe")}>
          <Maximize2 className="size-3.5" aria-hidden />
          Open radar
        </Button>
      </header>
      <div className="relative h-64 border-t border-line sm:h-80 lg:h-auto lg:min-h-80 lg:flex-1">
        <MapView center={loc} zoom={6} interactive={false}>
          <RadarLayer frames={loop.frames} index={loop.index} opacity={0.8} crisp={false} crossfadeMs={loop.crossfadeMs} onStatus={loop.onStatus} />
          <WarningsLayer alerts={alerts.data?.alerts ?? []} selectedId={null} onSelect={() => setMode("severe")} />
          <UserMarker lat={loc.lat} lon={loc.lon} />
        </MapView>
        <div className="absolute inset-x-2 bottom-2 sm:inset-x-3 sm:bottom-3">
          <RadarTimeline loop={loop} speed={1} onSpeed={() => {}} now={now} timeZone={timeZone} compact />
        </div>
      </div>
    </Panel>
  );
}
