"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hrrrFrames } from "@/lib/radar/hrrr";
import { frameBudget, framesFromScans, iemSiteId, MOSAIC_SITE, mosaicOffsetFrames, type RadarFrame } from "@/lib/radar/frames";
import type { BufferStatus } from "@/lib/radar/layer-manager";
import { crossfadeFor, frameDelayMs, nextPlayableIndex, stepIndex, type Speed } from "@/lib/radar/playback";
import { useNoaaTimes, useRadarScans } from "./queries";
import { noaaFrames, noaaLayerFor, noaaTilesUsable } from "@/lib/radar/noaa";

export type RadarSource = "noaa" | "iem";

export interface RadarLoopOptions {
  /** ICAO (KTLX) for single-site, or null for the national mosaic. */
  site: string | null;
  product: string;
  frameCount: number;
  speed: Speed;
  crossfade: boolean;
  autoplay?: boolean;
  /** Append this many hours of HRRR model forecast (national mosaic only). */
  futureHours?: number;
  /** Spread the loop's frames over this many minutes of history (0: the latest scans). */
  historyMinutes?: number;
}

export interface RadarLoop {
  frames: RadarFrame[];
  index: number;
  playing: boolean;
  ready: boolean[];
  buffered: number;
  crossfadeMs: number;
  isLoading: boolean;
  error: unknown;
  usingFallback: boolean;
  /** Where the scans come from: NOAA (MRMS / super-res NEXRAD) or IEM tiles. */
  source: RadarSource;
  /** "MRMS" or "KTLX SR" while NOAA is the source. */
  sourceLabel: string | null;
  /** Frames before this index are observed scans; the rest are model forecast. */
  liveCount: number;
  setIndex: (i: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  step: (delta: number) => void;
  onStatus: (s: BufferStatus) => void;
}

/**
 * Drives a radar loop: scan index → immutable frames → playback clock.
 * The clock only advances onto frames whose tiles are buffered, so the
 * viewer never sees a half-loaded frame.
 */
export function useRadarLoop({ site, product, frameCount, speed, crossfade, autoplay = true, futureHours = 0, historyMinutes = 0 }: RadarLoopOptions): RadarLoop {
  const isMosaic = site === null;
  const iemSite = isMosaic ? MOSAIC_SITE : iemSiteId(site);
  const iemProduct = isMosaic ? "N0Q" : product;
  const budget = useMemo(
    () => frameBudget(typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined),
    [],
  );
  const count = Math.min(frameCount, budget);
  const minutes = historyMinutes > 0 ? Math.min(240, historyMinutes + 10) : Math.min(240, count * (isMosaic ? 5 : 6) + 15);

  // Preferred source: NOAA itself (MRMS mosaic, super-res NEXRAD; lib/radar/noaa).
  // IEM's tiles cover everything else, and stand in whenever NOAA can't be reached.
  const noaaLayer = useMemo(() => noaaLayerFor(site, product), [site, product]);
  const [noaaOk, setNoaaOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!noaaLayer) return;
    let alive = true;
    void noaaTilesUsable().then((ok) => alive && setNoaaOk(ok));
    return () => {
      alive = false;
    };
  }, [noaaLayer]);
  const noaaTimes = useNoaaTimes(noaaLayer, minutes, noaaOk === true);
  const noaaList = noaaTimes.data?.times;
  const noaaFailed = noaaOk === false || noaaTimes.isError || (noaaTimes.isSuccess && !noaaList?.length);
  const useIem = !noaaLayer || noaaFailed;
  const noaaPending = !useIem && !noaaList?.length;
  const spanMs = (historyMinutes > 0 ? historyMinutes : count * (isMosaic ? 5 : 6)) * 60_000;

  const scans = useRadarScans(useIem ? iemSite : null, iemProduct, minutes);
  const scanList = useIem ? scans.data?.scans : undefined;
  const usingFallback = isMosaic && useIem && (scans.isError || (scans.isSuccess && !scanList?.length));
  const live = useMemo(() => {
    if (!useIem && noaaLayer && noaaList?.length) return noaaFrames(noaaLayer, noaaList, count, spanMs);
    // The feed may answer with a related code (N0U for N0G) when the preferred one has no scans.
    if (scanList?.length) return framesFromScans(scanList, iemSite, scans.data?.product ?? iemProduct, count, historyMinutes * 60_000);
    // Rolling-offset mosaic needs no index — always available as a fallback.
    if (usingFallback) return mosaicOffsetFrames(new Date(), Math.min(count, 12));
    return [];
  }, [useIem, noaaLayer, noaaList, spanMs, scanList, iemSite, iemProduct, count, usingFallback, scans.data?.product, historyMinutes]);
  const source: RadarSource = !useIem && live.length ? "noaa" : "iem";
  // Future frames follow the newest scan (which stands in for "now"); each new scan rebuilds them.
  const lastLive = live.at(-1)?.time ?? 0;
  const future = useMemo(
    () => (isMosaic && futureHours > 0 && lastLive ? hrrrFrames(lastLive, lastLive, futureHours) : []),
    [isMosaic, futureHours, lastLive],
  );
  const frames = useMemo(() => (future.length ? [...live, ...future] : live), [live, future]);
  const liveCount = live.length;

  const [index, setIndexState] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [ready, setReady] = useState<boolean[]>([]);
  const indexRef = useRef(index);
  const readyRef = useRef(ready);
  const framesRef = useRef(frames);

  // Keep showing the same scan when the list shifts; jump to "now" otherwise.
  useEffect(() => {
    const prevId = framesRef.current[indexRef.current]?.id;
    framesRef.current = frames;
    const keep = prevId ? frames.findIndex((f) => f.id === prevId) : -1;
    // Otherwise the newest observed scan, not the end of the forecast.
    const firstForecast = frames.findIndex((f) => f.forecast);
    const next = keep >= 0 ? keep : Math.max(0, (firstForecast < 0 ? frames.length : firstForecast) - 1);
    indexRef.current = next;
    setIndexState(next);
  }, [frames]);

  const setIndex = useCallback((i: number) => {
    indexRef.current = i;
    setIndexState(i);
  }, []);

  const onStatus = useCallback((s: BufferStatus) => {
    readyRef.current = s.ready;
    setReady(s.ready);
  }, []);

  // Playback clock (setTimeout chain: exact per-frame delays incl. last-frame dwell).
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const cur = indexRef.current;
      const next = nextPlayableIndex(cur, readyRef.current);
      if (next !== cur) setIndex(next);
      timer = setTimeout(tick, frameDelayMs(next, framesRef.current.length, speed));
    };
    timer = setTimeout(tick, frameDelayMs(indexRef.current, frames.length, speed));
    return () => clearTimeout(timer);
  }, [playing, speed, frames.length, setIndex]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex(stepIndex(indexRef.current, delta, framesRef.current.length));
    },
    [setIndex],
  );

  return {
    frames,
    index: Math.min(index, Math.max(0, frames.length - 1)),
    playing,
    ready,
    buffered: ready.filter(Boolean).length,
    crossfadeMs: crossfadeFor(speed, crossfade),
    isLoading: noaaPending || (useIem && scans.isLoading),
    error: usingFallback || !useIem ? null : scans.error,
    usingFallback,
    source,
    sourceLabel: source === "noaa" && noaaLayer ? noaaLayer.label : null,
    liveCount,
    setIndex: (i) => {
      setPlaying(false);
      setIndex(i);
    },
    toggle: () => setPlaying((p) => !p),
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    step,
    onStatus,
  };
}
