"use client";

import { useCallback, useState } from "react";
import { reverseGeocode } from "@/lib/api/open-meteo";
import { useAppStore } from "@/store/app-store";

export function useGeolocate() {
  const setLocation = useAppStore((s) => s.setLocation);
  const [state, setState] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState("error");
      setError("Geolocation isn't available in this browser");
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const name = await reverseGeocode(lat, lon).catch(() => "My location");
        setLocation({ lat, lon, name, source: "gps" });
        setState("idle");
        setError(null);
      },
      (err) => {
        setState("error");
        setError(err.code === err.PERMISSION_DENIED ? "Location permission denied" : "Couldn't get your location");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }, [setLocation]);

  return { locate, state, error };
}
