"use client";

import { useEffect, useMemo, useState } from "react";
import type { RadarFrame } from "@/lib/radar/frames";
import { gridCorners, motionPair, NOWCAST_LEADS, viewGrid, type NowcastSource } from "@/lib/radar/nowcast";
import { nowcastSupported, runNowcast } from "@/lib/radar/nowcast-client";

/** The subset of maplibregl.Map future radar needs. */
export interface NowcastMap {
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  getZoom(): number;
  on(type: "moveend", listener: () => void): unknown;
  off(type: "moveend", listener: () => void): unknown;
}

export interface NowcastView {
  /** [west, south, east, north] in degrees. */
  bounds: [number, number, number, number];
  zoom: number;
}

/** Whether the map moved enough to extrapolate again: ¾ of a zoom level, or the centre a quarter of the view away. */
export function viewMoved(prev: NowcastView | null, next: NowcastView): boolean {
  if (!prev) return true;
  if (Math.abs(prev.zoom - next.zoom) >= 0.75) return true;
  const [w, s, e, n] = prev.bounds;
  const [w2, s2, e2, n2] = next.bounds;
  return Math.abs((w + e - w2 - e2) / 2) > (e - w) / 4 || Math.abs((s + n - s2 - n2) / 2) > (n - s) / 4;
}

const sourceOf = (f: RadarFrame): NowcastSource => ({ template: f.tileUrl, tileSize: f.tileSize ?? 256, minzoom: f.minzoom ?? 0, maxzoom: f.maxzoom });

/** Short stable tag for a view, for frame ids. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * Future radar for a loop: the newest scan carried 10 … 60 minutes ahead
 * along the motion measured between it and a scan ~15 minutes earlier, over
 * the map's current view (lib/radar/nowcast.ts). Recomputed for each new scan
 * and when the view moves substantially; the previous frames stay up until
 * the new ones are ready. Empty while off, unsupported, or when there's
 * nothing to extrapolate.
 */
export function useNowcast(live: readonly RadarFrame[], map: NowcastMap | null, enabled: boolean): RadarFrame[] {
  const on = enabled && !!map && nowcastSupported();
  const [view, setView] = useState<NowcastView | null>(null);
  const [result, setResult] = useState<{ key: string; frames: RadarFrame[] } | null>(null);

  // Follow the view, settled for a moment after each move.
  useEffect(() => {
    if (!on || !map) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const b = map.getBounds();
      const next: NowcastView = { bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() };
      setView((prev) => (viewMoved(prev, next) ? next : prev));
    };
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(update, 800);
    };
    timer = setTimeout(update, 0);
    map.on("moveend", settle);
    return () => {
      clearTimeout(timer);
      map.off("moveend", settle);
    };
  }, [on, map]);

  // Tile scans only (decoded Pro images have no template to fetch).
  const pair = useMemo(() => (on ? motionPair(live.filter((f) => !f.image && f.tileUrl)) : null), [on, live]);
  const viewKey = view ? view.bounds.map((v) => v.toFixed(3)).join(",") : null;
  const key = pair && viewKey ? `${pair[0].id}|${pair[1].id}|${viewKey}` : null;

  useEffect(() => {
    if (!pair || !view || !key || result?.key === key) return;
    const [older, newer] = pair;
    const grid = viewGrid(view.bounds);
    const job = runNowcast({ older: sourceOf(older), newer: sourceOf(newer), gapMin: (newer.time - older.time) / 60_000, grid, leads: NOWCAST_LEADS });
    let alive = true;
    void job.promise.then((res) => {
      if (!alive) return;
      if (!res.ok) {
        // Nothing to extrapolate for this scan and view: don't keep asking.
        setResult({ key, frames: [] });
        return;
      }
      const coordinates = gridCorners(grid);
      const tag = hash(key);
      setResult({
        key,
        frames: res.frames.map(({ lead, image }) => ({
          id: `nowcast-${newer.id}-${tag}-${lead}`,
          time: newer.time + lead * 60_000,
          tileUrl: "",
          maxzoom: newer.maxzoom,
          forecast: true,
          nowcast: true,
          leadMinutes: lead,
          image: { url: URL.createObjectURL(image), coordinates },
        })),
      });
    });
    return () => {
      alive = false;
      job.cancel();
    };
  }, [pair, view, key, result?.key]);

  // A set's images are freed once the next one has replaced it on the map.
  useEffect(() => {
    const urls = result?.frames.map((f) => f.image!.url) ?? [];
    return () => {
      if (urls.length) setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 5_000);
    };
  }, [result]);

  return useMemo(() => (on && result ? result.frames : []), [on, result]);
}
