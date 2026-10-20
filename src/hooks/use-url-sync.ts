"use client";

import { useEffect } from "react";
import { isModeId } from "@/modes/registry";
import { archiveTime, isoMinute } from "@/lib/radar/archive";
import { useAppStore } from "@/store/app-store";

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
    // An empty value would read as 0 (the Gulf of Guinea).
    const lat = sp.get("lat") ? Number(sp.get("lat")) : NaN;
    const lon = sp.get("lon") ? Number(sp.get("lon")) : NaN;
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      setLocation({ lat, lon, name: sp.get("name")?.slice(0, 80) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, source: "url" });
    }
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
