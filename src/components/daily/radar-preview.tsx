"use client";

import { Maximize2 } from "lucide-react";
import { useNationalAlerts } from "@/hooks/queries";
import { useRadarLoop } from "@/hooks/use-radar-loop";
import { useAppStore } from "@/store/app-store";
import { MapView } from "../map/map-view";
import { RadarLayer } from "../map/layers/radar-layer";
import { UserMarker } from "../map/layers/user-marker";
import { WarningsLayer } from "../map/layers/warnings-layer";
import { RadarTimeline } from "../radar/radar-timeline";

/** Compact national-mosaic loop; tap through to Severe mode. */
export function RadarPreview({ now, timeZone }: { now: number; timeZone?: string }) {
  const loc = useAppStore((s) => s.location);
  const setMode = useAppStore((s) => s.setMode);
  const alerts = useNationalAlerts(true);
  const loop = useRadarLoop({ site: null, product: "N0Q", frameCount: 10, speed: 1, crossfade: true });

  return (
    <section className="glass relative h-[360px] overflow-hidden rounded-[var(--radius-pane)]" aria-label="Radar preview">
      <MapView center={loc} zoom={6} interactive={false}>
        <RadarLayer frames={loop.frames} index={loop.index} opacity={0.8} crisp={false} crossfadeMs={loop.crossfadeMs} onStatus={loop.onStatus} />
        <WarningsLayer alerts={alerts.data?.alerts ?? []} selectedId={null} onSelect={() => setMode("severe")} />
        <UserMarker lat={loc.lat} lon={loc.lon} />
      </MapView>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="glass-strong rounded-xl px-3 py-1.5">
          <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Live radar</p>
          <p className="text-sm font-semibold">NEXRAD mosaic</p>
        </div>
        <button type="button" onClick={() => setMode("severe")} className="glass-strong pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-white/10">
          <Maximize2 className="size-3.5" /> Open Severe mode
        </button>
      </div>
      <div className="absolute inset-x-3 bottom-3">
        <RadarTimeline loop={loop} speed={1} onSpeed={() => {}} now={now} timeZone={timeZone} compact />
      </div>
    </section>
  );
}
