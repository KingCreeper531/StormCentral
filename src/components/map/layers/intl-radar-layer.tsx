"use client";

import { useEffect, useMemo, useRef } from "react";
import { useIntlTimes } from "@/hooks/queries";
import { INTL_RADARS, intlRadarsInView, matchFrames, type IntlRadar, type IntlRadarId } from "@/lib/radar/intl";
import { RadarLayerManager, type RadarMap } from "@/lib/radar/layer-manager";
import type { RadarFrame } from "@/lib/radar/frames";
import { mapAlive, SLOTS, useMapContext } from "../map-view";

/** One source's frames on the map, showing whichever matches the loop's current time (none: hidden). */
function IntlSource({ frames, index, opacity, crossfadeMs }: { frames: RadarFrame[]; index: number; opacity: number; crossfadeMs: number }) {
  const { map } = useMapContext();
  const mgr = useRef<RadarLayerManager | null>(null);
  useEffect(() => {
    if (!map) return;
    // Beneath NOAA's radar: where both cover (the US–Canada border), NEXRAD wins.
    const m = new RadarLayerManager(map as unknown as RadarMap, { beforeId: () => SLOTS.heat });
    mgr.current = m;
    return () => {
      if (mapAlive(map)) m.destroy();
      mgr.current = null;
    };
  }, [map]);
  useEffect(() => {
    mgr.current?.sync(frames);
    mgr.current?.show(index);
  }, [frames, index, map]);
  useEffect(() => mgr.current?.setOpacity(opacity), [opacity, map]);
  useEffect(() => mgr.current?.setCrossfade(crossfadeMs), [crossfadeMs, map]);
  return null;
}

/**
 * Other countries' radar composites under the main loop, time-matched to
 * it: each loop frame shows each source's latest scan at or before that
 * time. Only sources whose coverage is in view are fetched. Without loop
 * times (the US loop failed) each source shows its own latest scan.
 */
export function IntlRadarLayers({ view, loopTimes, index, opacity, crossfadeMs }: { view: [number, number, number, number] | null; loopTimes: readonly number[]; index: number; opacity: number; crossfadeMs: number }) {
  // Re-evaluated only when the set of sources in view changes, not on every pan.
  const inViewKey = intlRadarsInView(view).map((r) => r.id).join(",");
  const sources = useMemo<IntlRadar[]>(() => (inViewKey ? inViewKey.split(",").map((id) => INTL_RADARS[id as IntlRadarId]) : []), [inViewKey]);
  const observed = loopTimes.filter(Number.isFinite);
  const span = observed.length > 1 ? Math.ceil((Math.max(...observed) - Math.min(...observed)) / 60_000) + 20 : 60;
  const hasLoop = observed.length > 0;
  const results = useIntlTimes(
    sources.map((s) => s.id),
    Math.min(250, span),
  );
  return (
    <>
      {sources.map((s, i) => {
        const times = results[i]?.data?.times ?? [];
        const own = hasLoop ? loopTimes : times.slice(-1).map((t) => Date.parse(t));
        return <MatchedSource key={s.id} source={s} times={times} loopTimes={own} index={hasLoop ? index : 0} opacity={opacity} crossfadeMs={crossfadeMs} />;
      })}
    </>
  );
}

function MatchedSource({ source, times, loopTimes, index, opacity, crossfadeMs }: { source: IntlRadar; times: string[]; loopTimes: readonly number[]; index: number; opacity: number; crossfadeMs: number }) {
  const matched = useMemo(() => matchFrames(source, times, loopTimes, source.stepMin * 2 + 2), [source, times, loopTimes]);
  return <IntlSource frames={matched.frames} index={matched.index[index] ?? -1} opacity={opacity} crossfadeMs={crossfadeMs} />;
}
