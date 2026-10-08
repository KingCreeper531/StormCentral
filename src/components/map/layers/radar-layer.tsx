"use client";

import { useEffect, useRef } from "react";
import type { RadarFrame } from "@/lib/radar/frames";
import { RadarLayerManager, type BufferStatus, type RadarMap } from "@/lib/radar/layer-manager";
import { mapAlive, SLOTS, useMapContext } from "../map-view";

interface Props {
  frames: readonly RadarFrame[];
  index: number;
  opacity: number;
  crisp: boolean;
  crossfadeMs: number;
  onStatus: (s: BufferStatus) => void;
}

/** Declarative wrapper around RadarLayerManager (see lib/radar/layer-manager.ts). */
export function RadarLayer({ frames, index, opacity, crisp, crossfadeMs, onStatus }: Props) {
  const { map } = useMapContext();
  const mgr = useRef<RadarLayerManager | null>(null);
  const statusCb = useRef(onStatus);
  useEffect(() => {
    statusCb.current = onStatus;
  });

  useEffect(() => {
    if (!map) return;
    const m = new RadarLayerManager(map as unknown as RadarMap, {
      beforeId: () => SLOTS.radar,
      attribution: 'NEXRAD via <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>',
      onStatus: (s) => statusCb.current(s),
    });
    mgr.current = m;
    return () => {
      if (mapAlive(map)) m.destroy();
      mgr.current = null;
    };
  }, [map]);

  useEffect(() => {
    mgr.current?.sync(frames);
    mgr.current?.show(index);
  }, [frames, index]);

  useEffect(() => mgr.current?.setOpacity(opacity), [opacity]);
  useEffect(() => mgr.current?.setCrisp(crisp), [crisp]);
  useEffect(() => mgr.current?.setCrossfade(crossfadeMs), [crossfadeMs]);

  return null;
}
