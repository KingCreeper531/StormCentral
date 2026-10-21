"use client";

import type { Map as MlMap } from "maplibre-gl";
import { ChevronLeft, ChevronRight, Expand, Pause, Play, Settings2, Shrink, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { useBroadcastStore, type BroadcastScene } from "@/store/broadcast-store";
import { IconButton } from "../ui/button";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** How long the bar stays after the last move or tap; longer on touch screens, where it takes a tap to find. */
const hideAfter = () => (window.matchMedia("(pointer: coarse)").matches ? 5000 : 2500);

/** Fly the map through the saved scenes, holding each for the tour's seconds. */
export function useSceneTour(map: MlMap | null) {
  const scenes = useBroadcastStore((s) => s.scenes);
  const seconds = useBroadcastStore((s) => s.tourSeconds);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  });

  const go = useCallback(
    (i: number) => {
      const s: BroadcastScene | undefined = scenes[((i % scenes.length) + scenes.length) % scenes.length];
      if (!s || !map) return;
      setIndex(scenes.indexOf(s));
      map.flyTo({ center: [s.lon, s.lat], zoom: s.zoom, duration: reducedMotion() ? 0 : 2500, essential: true });
    },
    [map, scenes],
  );
  const step = useCallback((by: 1 | -1) => go((indexRef.current ?? (by > 0 ? -1 : 0)) + by), [go]);

  useEffect(() => {
    if (!playing || scenes.length < 1) return;
    const id = setInterval(() => step(1), seconds * 1000);
    return () => clearInterval(id);
  }, [playing, scenes.length, seconds, step]);

  // A scene that was deleted can't stay current.
  const current = index != null && index < scenes.length ? scenes[index]! : null;
  const play = () => {
    if (!scenes.length) return;
    setPlaying(true);
    step(1);
  };
  const stop = () => setPlaying(false);
  // Moving the map by hand leaves the scene (the lower third goes back to the view's own title).
  const leave = useCallback(() => {
    setPlaying(false);
    setIndex(null);
  }, []);
  return { scenes, current, playing: playing && scenes.length > 0, play, stop, step, leave };
}

export type SceneTour = ReturnType<typeof useSceneTour>;

/**
 * Broadcast mode's controls: a bar along the top that shows while the
 * pointer moves, on a tap (phones have no pointer to move), or while a
 * control has focus, and hides itself on air. Scenes, the tour, full
 * screen, settings and the way out (Esc and the back button work too).
 */
export function BroadcastControls({ tour, onSettings, onExit, extra }: { tour: SceneTour; onSettings: () => void; onExit: () => void; extra?: React.ReactNode }) {
  const t = useT();
  const [shown, setShown] = useState(true);
  const [full, setFull] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const poke = () => {
      setShown(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(false), hideAfter());
    };
    poke();
    window.addEventListener("pointermove", poke);
    // Captured, so a tap on the map shows the bar too.
    window.addEventListener("pointerdown", poke, true);
    window.addEventListener("keydown", poke);
    return () => {
      window.removeEventListener("pointermove", poke);
      window.removeEventListener("pointerdown", poke, true);
      window.removeEventListener("keydown", poke);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const n = tour.scenes.length;
  return (
    <div
      role="toolbar"
      aria-label={t("Broadcast controls")}
      className={cn(
        "overlay absolute top-3 left-1/2 z-40 flex w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 px-1.5 py-1 transition-opacity duration-300 focus-within:opacity-100",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <IconButton size="sm" label={t("Previous scene")} disabled={!n} onClick={() => tour.step(-1)}>
        <ChevronLeft className="size-4" aria-hidden />
      </IconButton>
      <span className="max-w-[12rem] min-w-[6rem] truncate px-1 text-center text-xs text-ink-2">{tour.current ? tour.current.name : n ? t.plural(n, "{n} scene", "{n} scenes") : t("No scenes saved")}</span>
      <IconButton size="sm" label={t("Next scene")} disabled={!n} onClick={() => tour.step(1)}>
        <ChevronRight className="size-4" aria-hidden />
      </IconButton>
      <IconButton size="sm" label={tour.playing ? t("Stop the tour") : t("Play the tour")} disabled={!n} onClick={tour.playing ? tour.stop : tour.play} aria-pressed={tour.playing}>
        {tour.playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
      </IconButton>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      {extra}
      <IconButton size="sm" label={full ? t("Leave full screen") : t("Full screen")} onClick={toggleFull} aria-pressed={full}>
        {full ? <Shrink className="size-4" aria-hidden /> : <Expand className="size-4" aria-hidden />}
      </IconButton>
      <IconButton size="sm" label={t("Broadcast settings")} onClick={onSettings}>
        <Settings2 className="size-4" aria-hidden />
      </IconButton>
      <IconButton size="sm" label={t("Leave broadcast mode")} onClick={onExit}>
        <X className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}
