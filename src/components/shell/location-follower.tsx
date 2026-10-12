"use client";

import { useEffect } from "react";
import { reverseGeocode } from "@/lib/api/open-meteo";
import { haversineKm } from "@/lib/geo";
import { useAppStore } from "@/store/app-store";

/** Move at least this far before the location (and its forecast) updates. */
const MIN_MOVE_KM = 2;
/** And at most this often, so a drive doesn't refetch every few seconds. */
const MIN_INTERVAL_MS = 60_000;

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Headless. While "My location" is the selected place and following is on,
 * watches the device position and moves the location with you, renaming it
 * as you pass through towns. Search for a place and following stops until
 * you pick My location again.
 */
export function LocationFollower() {
  const hydrated = useAppStore((s) => s.hydrated);
  const follow = useAppStore((s) => s.followLocation);
  const gps = useAppStore((s) => s.location.source === "gps");

  useEffect(() => {
    if (!hydrated || !follow || !gps || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    let last = 0;
    let busy = false;
    let live = true;
    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const cur = useAppStore.getState().location;
        const now = Date.now();
        if (busy || cur.source !== "gps" || now - last < MIN_INTERVAL_MS) return;
        if (haversineKm(cur, { lat, lon }) < MIN_MOVE_KM) return;
        busy = true;
        last = now;
        const name = await reverseGeocode(lat, lon).catch(() => cur.name);
        busy = false;
        // The user may have picked another place while the name was looked up.
        if (!live || useAppStore.getState().location.source !== "gps") return;
        useAppStore.getState().setLocation({ lat: round(lat), lon: round(lon), name, source: "gps" });
      },
      () => {
        /* permission revoked or no fix: keep the last known location */
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 60_000 },
    );
    return () => {
      live = false;
      navigator.geolocation.clearWatch(id);
    };
  }, [hydrated, follow, gps]);

  return null;
}
