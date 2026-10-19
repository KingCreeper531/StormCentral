"use client";

import { useEffect, useMemo, useState } from "react";
import { useNoaaTimes, useRadarProducts } from "@/hooks/queries";
import { useRadarLoop } from "@/hooks/use-radar-loop";
import { mrmsLayer, PRO_PRODUCTS, satelliteFrames, type ProProductId } from "@/lib/pro/products";
import { useProSync } from "@/lib/pro/sync";
import { iemSiteId, type RadarFrame } from "@/lib/radar/frames";
import { noaaFrames, noaaTilesUsable } from "@/lib/radar/noaa";
import { FAMILIES, resolveTilts, type ProductFamily, type ResolvedTilt, type TiltPrefix } from "@/lib/radar/products";
import { pickSatellite } from "@/lib/radar/satellite";
import { usePro } from "./pro-context";

/** Everything a pane knows about its product's loop. */
export interface PaneFeed {
  frames: RadarFrame[];
  family: ProductFamily | null;
  /** Tilts the site is sending for this product (site products only). */
  tilts: ResolvedTilt[];
  /** The tilt actually shown. */
  tilt: ResolvedTilt | null;
  /** Where the tiles come from: "NOAA KTLX SR", "IEM", "MRMS", "GIBS". */
  source: string;
  loading: boolean;
  /** Nothing to show (no scans, source unreachable). */
  empty: boolean;
  /** The data source lists the site's products and this one isn't among them. */
  missing?: boolean;
}

export const EMPTY_FEED: PaneFeed = { frames: [], family: null, tilts: [], tilt: null, source: "", loading: true, empty: false };

interface SourceProps {
  product: ProProductId;
  site: string;
  tilt: TiltPrefix;
  frameCount: number;
  /** This pane sets the loop's times (so satellite panes don't follow themselves). */
  basis: boolean;
  onFeed: (f: PaneFeed) => void;
}

/** Report a feed upward whenever what it shows changes. */
function useReport(onFeed: (f: PaneFeed) => void, feed: PaneFeed) {
  const { frames, family, tilts, tilt, source, loading, empty, missing = false } = feed;
  useEffect(() => {
    onFeed({ frames, family, tilts, tilt, source, loading, empty, missing });
  }, [onFeed, frames, family, tilts, tilt, source, loading, empty, missing]);
}

function SiteSource({ product, site, tilt, frameCount, onFeed }: SourceProps) {
  const def = PRO_PRODUCTS[product];
  const family = def.kind === "site" ? def.family : "reflectivity";
  const products = useRadarProducts(iemSiteId(site));
  const available = useMemo(() => (products.data?.products.length ? new Set(products.data.products) : null), [products.data]);
  const tilts = useMemo(() => resolveTilts(family, available), [family, available]);
  const chosen = tilts.find((x) => x.prefix === tilt) ?? tilts[0] ?? null;
  const code = chosen?.code ?? `N0${FAMILIES[family].letters[0]}`;
  const loop = useRadarLoop({ site, product: code, frameCount, speed: 1, crossfade: false, autoplay: false });
  useReport(onFeed, {
    frames: loop.frames,
    family,
    tilts,
    tilt: chosen,
    source: loop.sourceLabel ? `NOAA ${loop.sourceLabel}` : `IEM ${site} ${code}`,
    loading: loop.isLoading,
    empty: !loop.isLoading && !loop.frames.length,
    // IEM listed the site's products and this family isn't among them.
    missing: !!available && !tilts.length && !loop.frames.length,
  });
  return null;
}

function MosaicSource({ frameCount, onFeed }: SourceProps) {
  const loop = useRadarLoop({ site: null, product: "N0Q", frameCount, speed: 1, crossfade: false, autoplay: false });
  useReport(onFeed, {
    frames: loop.frames,
    family: "reflectivity",
    tilts: [],
    tilt: null,
    source: loop.sourceLabel ? `NOAA ${loop.sourceLabel}` : "IEM N0Q",
    loading: loop.isLoading,
    empty: !loop.isLoading && !loop.frames.length,
  });
  return null;
}

const noTilts: ResolvedTilt[] = [];

function MrmsSource({ product, frameCount, onFeed }: SourceProps) {
  const layer = useMemo(() => mrmsLayer(product), [product]);
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void noaaTilesUsable().then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  const minutes = Math.min(240, frameCount * 5 + 15);
  const times = useNoaaTimes(layer, minutes, ok === true);
  const list = times.data?.times;
  const frames = useMemo(() => (layer && list?.length ? noaaFrames(layer, list, frameCount, frameCount * 5 * 60_000) : []), [layer, list, frameCount]);
  useReport(onFeed, {
    frames,
    family: null,
    tilts: noTilts,
    tilt: null,
    source: "NOAA MRMS",
    loading: ok === null || times.isLoading,
    empty: ok === false || times.isError || (times.isSuccess && !frames.length),
  });
  return null;
}

function SatelliteSource({ product, frameCount, basis, onFeed }: SourceProps) {
  const { sync } = usePro();
  const timeline = useProSync(sync, (s) => s.timeline);
  // GOES-East or -West by where the view is, with hysteresis (lib/radar/satellite).
  const [sat, setSat] = useState(() => pickSatellite(sync.getState().camera.lng));
  useEffect(() => sync.subscribe((s) => setSat((prev) => pickSatellite(s.camera.lng, prev))), [sync]);
  // Refresh the newest slot every few minutes when nothing else moves the loop.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  const frames = useMemo(() => satelliteFrames(product, sat, basis ? [] : timeline, frameCount, tick), [product, sat, basis, timeline, frameCount, tick]);
  const def = PRO_PRODUCTS[product];
  useReport(onFeed, {
    frames,
    family: null,
    tilts: noTilts,
    tilt: null,
    source: def.kind === "nowcoast" ? "NOAA nowCOAST" : `GIBS GOES-${sat === "west" ? "West" : "East"}`,
    loading: false,
    empty: !frames.length,
  });
  return null;
}

/** Picks the loader for a product; renders nothing. */
export function FrameSource(props: SourceProps) {
  const kind = PRO_PRODUCTS[props.product].kind;
  // Keyed so switching product kinds starts from a clean loader.
  if (kind === "site") return <SiteSource key={`site-${props.site}`} {...props} />;
  if (kind === "mosaic") return <MosaicSource key="mosaic" {...props} />;
  if (kind === "mrms") return <MrmsSource key={`mrms-${props.product}`} {...props} />;
  return <SatelliteSource key={`sat-${props.product}`} {...props} />;
}
