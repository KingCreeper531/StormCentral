"use client";

import { useCallback, useState } from "react";
import { reverseGeocode } from "@/lib/api/open-meteo";
import { getFreshPosition, PositionError } from "@/lib/device-position";
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
    getFreshPosition(navigator.geolocation)
      .then(async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const name = await reverseGeocode(lat, lon).catch(() => "My location");
        setLocation({ lat, lon, name, source: "gps" });
        setState("idle");
        setError(null);
      })
      .catch((err: unknown) => {
        setState("error");
        setError(err instanceof PositionError ? err.message : "Couldn't get your location");
      });
  }, [setLocation]);

  return { locate, state, error };
}
