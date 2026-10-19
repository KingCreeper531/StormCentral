"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/hooks/queries";
import { HttpError } from "@/lib/api/http";
import { MAX_ACCURACY_M, motionOf, parseStream, SEND_INTERVAL_MS, shouldSend, type PositionInput, type SentFix } from "@/lib/chasers";
import { FRESH_MS, isUsableFix } from "@/lib/device-position";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { useChaserStore } from "@/store/chaser-store";

/** How long a parked chaser's last fix keeps being re-sent. */
const RESEND_FOR_MS = 10 * 60_000;

async function chasers(method: "PUT" | "DELETE", body?: PositionInput) {
  const res = await fetch("/api/chasers", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    keepalive: method === "DELETE",
  });
  if (!res.ok) throw new HttpError(`Request failed (${res.status})`, res.status, "/api/chasers");
}

/**
 * Headless. While sharing is on (Settings → Account) and someone is signed
 * in, watches the GPS and sends the position: the first fix at once, then
 * about every 50 s, or sooner after moving 300 m. A parked chaser's phone may
 * stop reporting fixes, so the last one is re-sent to keep the marker fresh.
 * Sharing switches itself off when its window ends; switching it off deletes
 * the position from the server.
 */
export function ChaserBeacon() {
  const hydrated = useChaserStore((s) => s.hydrated);
  const sharing = useChaserStore((s) => s.sharing);
  const until = useChaserStore((s) => s.until);
  const signedIn = !!useSession().data;
  const active = COMMUNITY_ENABLED && hydrated && sharing && until != null && signedIn;

  // The window ending turns sharing off (which deletes the position below).
  useEffect(() => {
    if (!sharing || until == null) return;
    const id = setTimeout(() => useChaserStore.getState().setSharing(false), Math.max(0, until - Date.now()));
    return () => clearTimeout(id);
  }, [sharing, until]);

  // Stopping deletes the position (signing out does too, server-side).
  const wasActive = useRef(false);
  useEffect(() => {
    if (active) {
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    useChaserStore.getState().setStatus("off");
    void chasers("DELETE").catch(() => {
      /* signed out or offline: the server drops it after 15 minutes */
    });
  }, [active]);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    const store = useChaserStore.getState;
    store().setStatus("locating");
    let sent: SentFix | null = null;
    let latest: { pos: GeolocationPosition; at: number } | null = null;
    let busy = false;
    let live = true;

    const send = async (pos: GeolocationPosition, now: number, resend = false) => {
      const end = store().until;
      if (busy || !live || end == null) return;
      const fix = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      // A re-sent fix is a chaser standing still: no heading, no speed.
      const motion = resend ? { heading: null, speedKmh: 0 } : motionOf(pos.coords, fix, sent, now);
      busy = true;
      try {
        // Only a link that checks out goes along; a half-typed one would make the server refuse the position.
        const stream = parseStream(store().stream) ? store().stream.trim() : null;
        await chasers("PUT", { ...fix, ...motion, accuracyM: Math.min(MAX_ACCURACY_M, Math.round(pos.coords.accuracy)), until: end, stream });
        sent = { ...fix, at: now };
        if (live) store().setStatus("live", Date.now());
      } catch (err) {
        if (!live) return;
        // Signed out somewhere else: stop. Too soon: try again with the next fix.
        if (err instanceof HttpError && err.status === 401) store().setSharing(false);
        else if (!(err instanceof HttpError && err.status === 429)) store().setStatus("error");
      } finally {
        busy = false;
      }
    };

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (!isUsableFix(pos, now, FRESH_MS, MAX_ACCURACY_M)) return;
        latest = { pos, at: now };
        if (shouldSend(sent, { lat: pos.coords.latitude, lon: pos.coords.longitude }, now)) void send(pos, now);
      },
      (err) => {
        if (live && err.code === err.PERMISSION_DENIED) store().setStatus("denied");
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 60_000 },
    );
    // Without a fix for 10 minutes (no signal), stop re-sending and let the marker go stale.
    const heartbeat = setInterval(() => {
      const now = Date.now();
      if (latest && sent && now - sent.at >= SEND_INTERVAL_MS && now - latest.at < RESEND_FOR_MS) void send(latest.pos, now, now - latest.at >= SEND_INTERVAL_MS);
    }, 15_000);
    return () => {
      live = false;
      navigator.geolocation.clearWatch(id);
      clearInterval(heartbeat);
    };
  }, [active]);

  return null;
}
