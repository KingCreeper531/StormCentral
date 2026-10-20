"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/api/http";
import { cleanShapes, type Shape } from "@/lib/draw/shapes";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { useDrawStore } from "@/store/draw-store";
import { DrawingLayer } from "./drawing-layer";

/** Whether the signed-in account can draw on the live stream (moderators and developers). */
export function usePresenter() {
  const q = useQuery({
    queryKey: ["presenter"],
    queryFn: ({ signal }) => getJson<{ presenter?: boolean }>("/api/auth/me", { signal }).then((r) => r.presenter === true),
    enabled: COMMUNITY_ENABLED,
    staleTime: 5 * 60_000,
  });
  return q.data === true;
}

/**
 * While the drawing is on air, every change goes to the stream (a moment
 * after the last one); taking it off air clears the stream's drawing.
 */
export function useLiveDrawingPublisher(presenter: boolean): "idle" | "sending" | "error" {
  const shapes = useDrawStore((s) => s.shapes);
  const onAir = useDrawStore((s) => s.onAir && presenter);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const wasOn = useRef(false);

  useEffect(() => {
    if (!onAir) return;
    const id = setTimeout(() => {
      setStatus("sending");
      fetch("/api/live-drawing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shapes }) })
        .then((r) => setStatus(r.ok ? "idle" : "error"))
        .catch(() => setStatus("error"));
    }, 300);
    return () => clearTimeout(id);
  }, [onAir, shapes]);

  useEffect(() => {
    if (wasOn.current && !onAir) void fetch("/api/live-drawing", { method: "DELETE" }).catch(() => {});
    wasOn.current = onAir;
  }, [onAir]);

  return status;
}

declare global {
  interface Window {
    /** The live stream's director draws its own annotations through this (stream/director.ts). */
    stormcentralDraw?: (shapes: unknown) => void;
  }
}

/** The stream's page is opened with this flag (stream/director.ts). */
const isStreamPage = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("scl_draw") === "1";

/**
 * On the live stream's page only: the presenter's drawing (polled every two
 * seconds) and the director's own annotations, drawn on the map.
 */
export function LiveDrawingLayer() {
  const [stream] = useState(isStreamPage);
  const [auto, setAuto] = useState<Shape[]>([]);
  const live = useQuery({
    queryKey: ["live-drawing"],
    queryFn: ({ signal }) => getJson<{ shapes: unknown }>("/api/live-drawing", { signal }).then((r) => cleanShapes(r.shapes)),
    enabled: stream && COMMUNITY_ENABLED,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!stream) return;
    window.stormcentralDraw = (shapes) => setAuto(cleanShapes(shapes));
    return () => {
      delete window.stormcentralDraw;
    };
  }, [stream]);

  if (!stream) return null;
  return (
    <>
      <DrawingLayer id="auto" shapes={auto} />
      <DrawingLayer id="live" shapes={live.data ?? []} />
    </>
  );
}
