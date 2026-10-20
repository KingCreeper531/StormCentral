"use client";

import type { LatLon } from "@/lib/geo";
import { useProStore } from "@/store/pro-store";
import { Meteogram } from "../charts/meteogram";

/** The Meteogram tool's panel: models and ensembles for the clicked spot (the same spot as Sounding). */
export function MeteogramPanel({ point, timeZone }: { point: LatLon; timeZone?: string }) {
  const models = useProStore((s) => s.meteogramModels);
  const setModels = useProStore((s) => s.setMeteogramModels);
  const ensemble = useProStore((s) => s.meteogramEnsemble);
  const setEnsemble = useProStore((s) => s.setMeteogramEnsemble);
  return (
    <div className="space-y-2 p-3">
      <p className="font-mono text-[11px] text-ink-3">
        {point.lat.toFixed(2)}, {point.lon.toFixed(2)}
      </p>
      <Meteogram point={point} models={models} onModels={setModels} ensemble={ensemble} onEnsemble={setEnsemble} timeZone={timeZone} />
    </div>
  );
}
