"use client";

import { useEffect } from "react";
import { isModeId } from "@/modes/registry";
import { archiveTime, isoMinute } from "@/lib/radar/archive";
import { useAppStore, type AppLocation } from "@/store/app-store";

/** Rounded as the query string holds it (-0 and 0 alike). */
const at4 = (v: number) => Number(v.toFixed(4));

/**
 * The place in the query string, or null when there is none or it's the
 * persisted place: reloading the page keeps that one and its source, so My
 * location stays My location and keeps following you. A link to anywhere
 * else opens there.
 */
export function urlLocation(sp: URLSearchParams, current: AppLocation): AppLocation | null {
  // An empty value would read as 0 (the Gulf of Guinea).
  const lat = sp.get("lat") ? Number(sp.get("lat")) : NaN;
  const lon = sp.get("lon") ? Number(sp.get("lon")) : NaN;
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  if (at4(lat) === at4(current.lat) && at4(lon) === at4(current.lon)) return null;
  return { lat, lon, name: sp.get("name")?.slice(0, 80) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, source: "url" };
}

/**
 * Two-way sync between the store and the query string (?mode=&lat=&lon=&name=,
 * and &at= while looking back at the radar archive) so any view is shareable.
 * Uses history.replaceState — no router re-render.
 */
export function useUrlSync() {
  const hydrated = useAppStore((s) => s.hydrated);

  // URL → store (once, after persisted state is restored; URL wins).
  useEffect(() => {
    if (!hydrated) return;
    const sp = new URLSearchParams(window.location.search);
    const { setMode, setLocation, setArchiveAt } = useAppStore.getState();
    const mode = sp.get("mode");
    if (isModeId(mode)) setMode(mode);
    const loc = urlLocation(sp, useAppStore.getState().location);
    if (loc) setLocation(loc);
    const at = archiveTime(sp.get("at"));
    if (at != null) setArchiveAt(at);
  }, [hydrated]);

  // store → URL
  useEffect(() => {
    if (!hydrated) return;
    return useAppStore.subscribe((s, prev) => {
      if (s.mode === prev.mode && s.location === prev.location && s.archiveAt === prev.archiveAt) return;
      const sp = new URLSearchParams(window.location.search);
      sp.set("mode", s.mode);
      sp.set("lat", s.location.lat.toFixed(4));
      sp.set("lon", s.location.lon.toFixed(4));
      sp.set("name", s.location.name);
      if (s.archiveAt != null) sp.set("at", isoMinute(s.archiveAt));
      else sp.delete("at");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${sp}`);
    });
  }, [hydrated]);
}
