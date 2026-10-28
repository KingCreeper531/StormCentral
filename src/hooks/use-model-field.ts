"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { BBox } from "@/lib/geo";
import { fetchModelGrid, hourIndex, planGrid, planServes, type GridPlan } from "@/lib/model-fields/grid";
import type { ModelFieldSetting } from "@/lib/model-fields/scales";
import { useNow } from "./use-now";

/** Milliseconds per hour step while the model map plays. */
const PLAY_MS = 700;
const NO_TIMES: number[] = [];
const planKey = (p: GridPlan) => ["modelGrid", p.bbox.west, p.bbox.south, p.bbox.east, p.bbox.north, p.cols, p.rows] as const;

/**
 * The model map's data and time slider (lib/model-fields): nothing is
 * fetched while it's off. The grid follows the map once it has settled, and
 * a pan or zoom the current grid still covers fetches nothing.
 */
export function useModelField(field: ModelFieldSetting, view: BBox | null) {
  const on = field !== "off";
  const [settled, setSettled] = useState<BBox | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSettled(on ? view : null), 600);
    return () => clearTimeout(t);
  }, [on, view]);

  const [plan, setPlan] = useState<GridPlan | null>(null);
  // Keep the grid while it still serves the view (adjusting state during render, as React recommends).
  if (settled && !(plan && planServes(plan, settled))) {
    const next = planGrid(settled);
    if (!plan || planKey(next).join() !== planKey(plan).join()) setPlan(next);
  }

  const query = useQuery({
    queryKey: plan ? planKey(plan) : ["modelGrid", "none"],
    queryFn: ({ signal }) => fetchModelGrid(plan!, signal),
    enabled: on && !!plan,
    // Open-Meteo refreshes its models hourly at most; the slider counts from the current hour.
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  // The chosen hour, as a time so it survives a refetch; null follows now.
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const now = useNow(60_000);
  const grid = on ? (query.data ?? null) : null;
  const times = grid?.times ?? NO_TIMES;
  const index = hourIndex(times, at ?? now);
  const count = times.length;

  useEffect(() => {
    if (!playing || count < 2) return;
    const id = setInterval(() => {
      setAt((cur) => {
        const i = hourIndex(times, cur ?? Date.now());
        return times[(i + 1) % count]!;
      });
    }, PLAY_MS);
    return () => clearInterval(id);
  }, [playing, count, times]);

  return {
    on,
    grid,
    index,
    times,
    /** Show hour `i` (stops playback). */
    setIndex: (i: number) => {
      setPlaying(false);
      setAt(times[i] ?? null);
    },
    playing: playing && on,
    togglePlay: () => setPlaying((p) => !p),
    isFetching: on && query.isFetching,
    error: on ? query.error : null,
    retry: () => void query.refetch(),
  };
}

export type ModelFieldState = ReturnType<typeof useModelField>;
