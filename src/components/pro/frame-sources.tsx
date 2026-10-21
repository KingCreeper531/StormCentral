"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useIntlTimes, useNoaaTimes, useRadarProducts } from "@/hooks/queries";
import { useRadarLoop } from "@/hooks/use-radar-loop";
import { listLevel2, listLevel3, liveVolumes, newest } from "@/lib/pro/nexrad/aws";
import { decodedVersion, holdDecodes, jobKey, liveJob, peekDecoded, subscribeDecoded, type DecodeJob } from "@/lib/pro/nexrad/client";
import { archiveNote, l3CodeFor, mrmsLayer, PRO_PRODUCTS, satelliteFrames, type ProProductId } from "@/lib/pro/products";
import { sweepColors, type Sweep } from "@/lib/pro/nexrad/sweep";
import { paletteScale, type Palette } from "@/lib/pro/palettes";
import type { DecodedScaleId, ValueScale } from "@/lib/pro/scales";
import { fetchServerIndex, PRO_SERVER, serverFrames } from "@/lib/pro/server";
import { useProSync } from "@/lib/pro/sync";
import { iemSiteId, type RadarFrame } from "@/lib/radar/frames";
import { INTL_RADARS, intlFrame } from "@/lib/radar/intl";
import { noaaFrames, noaaTilesUsable } from "@/lib/radar/noaa";
import { FAMILIES, resolveTilts, TILTS, type ProductFamily, type ResolvedTilt, type TiltPrefix } from "@/lib/radar/products";
import { pickSatellite } from "@/lib/radar/satellite";
import { getSite } from "@/lib/radar/site-utils";
import { useAppStore } from "@/store/app-store";
import { usePalette } from "@/store/palette-store";
import { usePro } from "./pro-context";
import type { ProCaps } from "./use-pro-caps";

/** Everything a pane knows about its product's loop. */
export interface PaneFeed {
  frames: RadarFrame[];
  family: ProductFamily | null;
  /** Tilts the pane can switch between (site products). */
  tilts: ResolvedTilt[];
  /** The tilt actually shown. */
  tilt: ResolvedTilt | null;
  /** Level II: the volume's elevation angles. */
  elevations?: number[];
  /** Where the data comes from: "NOAA KTLX SR", "IEM", "MRMS", "GIBS", "NOAA L3 TLX N0C". */
  source: string;
  loading: boolean;
  /** Nothing to show (no scans, source unreachable). */
  empty: boolean;
  /** The data source lists the site's products and this one isn't among them. */
  missing?: boolean;
  /** Why there's nothing (shown instead of the generic note). */
  note?: string;
  /** Colour scale of decoded or server products (tile products are recognised from their URLs). */
  scale?: ValueScale | null;
  /** Frames hold decoded radar: the readout reads exact values instead of colours. */
  decoded?: boolean;
  /** Decoded products: which scale they're on (for picking a colour table). */
  scaleId?: DecodedScaleId;
}

export const EMPTY_FEED: PaneFeed = { frames: [], family: null, tilts: [], tilt: null, source: "", loading: true, empty: false };

interface SourceProps {
  product: ProProductId;
  site: string;
  tilt: TiltPrefix;
  elev: number;
  frameCount: number;
  /** This pane sets the loop's times (so satellite panes don't follow themselves). */
  basis: boolean;
  caps: ProCaps;
  onFeed: (f: PaneFeed) => void;
  /** Looking back at the archive: the loop ends at this past time (set by FrameSource). */
  until?: number | null;
}

/** Report a feed upward whenever what it shows changes. */
function useReport(onFeed: (f: PaneFeed) => void, feed: PaneFeed) {
  const { frames, family, tilts, tilt, elevations, source, loading, empty, missing = false, note, scale, decoded, scaleId } = feed;
  useEffect(() => {
    onFeed({ frames, family, tilts, tilt, elevations, source, loading, empty, missing, note, scale, decoded, scaleId });
  }, [onFeed, frames, family, tilts, tilt, elevations, source, loading, empty, missing, note, scale, decoded, scaleId]);
}

const noTilts: ResolvedTilt[] = [];

/** Every Level III tilt, for products decoded from AWS (all six are published). */
const tiltsFor = (letter: string): ResolvedTilt[] => TILTS.map((t) => ({ ...t, code: `${t.prefix}${letter}` }));

function SiteSource({ product, site, tilt, frameCount, onFeed }: SourceProps) {
  const def = PRO_PRODUCTS[product];
  const family = def.kind === "site" ? def.family : "reflectivity";
  const letter = def.kind === "site" ? def.l3Letter : undefined;
  const products = useRadarProducts(iemSiteId(site));
  const available = useMemo(() => (products.data?.products.length ? new Set(products.data.products) : null), [products.data]);
  const iemTilts = useMemo(() => resolveTilts(family, available), [family, available]);
  // Reflectivity and velocity switch to decoded Level III above the lowest tilt, so offer all six.
  const tilts = useMemo(() => (letter ? tiltsFor(letter) : iemTilts), [letter, iemTilts]);
  const chosen = tilts.find((x) => x.prefix === tilt) ?? tilts[0] ?? null;
  const code = iemTilts.find((x) => x.prefix === "N0")?.code ?? `N0${FAMILIES[family].letters[0]}`;
  const loop = useRadarLoop({ site, product: letter ? `N0${FAMILIES[family].letters[0]}` : (chosen?.code ?? code), frameCount, speed: 1, crossfade: false, autoplay: false });
  useReport(onFeed, {
    frames: loop.frames,
    family,
    tilts,
    tilt: chosen,
    source: loop.sourceLabel ? `NOAA ${loop.sourceLabel}` : `IEM ${site} ${chosen?.code ?? code}`,
    loading: loop.isLoading,
    empty: !loop.isLoading && !loop.frames.length,
    // IEM listed the site's products and this family isn't among them.
    missing: !letter && !!available && !iemTilts.length && !loop.frames.length,
  });
  return null;
}

const NO_CUTS: readonly number[] = [];

/** Decoded sweeps' colours in a picked colour table, worked out once per sweep and table. */
const recoloured = new WeakMap<Sweep, Map<string, Uint8Array>>();
function coloursIn(sweep: Sweep, scaleId: DecodedScaleId, palette: Palette): Uint8Array {
  let byPalette = recoloured.get(sweep);
  if (!byPalette) recoloured.set(sweep, (byPalette = new Map()));
  let colors = byPalette.get(palette.id);
  if (!colors) byPalette.set(palette.id, (colors = sweepColors(sweep, paletteScale(scaleId, palette))));
  return colors;
}

/** A product's colour table and the scale it makes (stable while neither changes, so feeds don't churn). */
function useDecodedScale(scaleId: DecodedScaleId) {
  const palette = usePalette(scaleId);
  const scale = useMemo(() => paletteScale(scaleId, palette), [scaleId, palette]);
  return { palette, scale };
}

/**
 * Decode a list of files (once each, cached) and return the frames that are
 * ready, in order, in the picked colour table (the worker colours them in
 * the standard one).
 */
function useDecodedFrames(jobs: readonly { job: DecodeJob; time: number }[], scaleId: DecodedScaleId, palette: Palette | null) {
  // Held while shown: other panes' decodes don't evict this pane's frames.
  useEffect(() => holdDecodes(jobs.map((j) => j.job)), [jobs]);
  // Re-render as frames land (anywhere); `readyKey` below decides whether this pane's changed.
  useSyncExternalStore(subscribeDecoded, decodedVersion, () => 0);
  // Identity only changes when the set of finished frames does.
  // (Newline-separated: job keys themselves contain "|".)
  const readyKey = jobs.map((j) => (peekDecoded(jobKey(j.job))?.state === "done" ? jobKey(j.job) : "")).join("\n");
  const frames = useMemo<RadarFrame[]>(() => {
    const done = new Set(readyKey.split("\n"));
    return jobs.flatMap(({ job, time }) => {
      const e = done.has(jobKey(job)) ? peekDecoded(jobKey(job)) : undefined;
      if (e?.state !== "done") return [];
      // A new id for new colours: the GPU layer uploads each frame once per id.
      const id = palette ? `${e.frame.key}#${palette.id}` : e.frame.key;
      const colors = palette ? coloursIn(e.frame.sweep, scaleId, palette) : e.frame.colors;
      return [{ id, time, tileUrl: "", maxzoom: 0, sweep: { sweep: e.frame.sweep, colors } }];
    });
  }, [jobs, readyKey, scaleId, palette]);
  let failed = 0;
  // A constant when there are none: a new [] each render would re-report the feed forever.
  let cuts: readonly number[] = NO_CUTS;
  let elevation: number | null = null;
  for (const j of jobs) {
    const e = peekDecoded(jobKey(j.job));
    if (e?.state === "error") {
      failed++;
      if (e.cuts?.length) cuts = e.cuts;
    } else if (e?.state === "done") {
      if (e.frame.cuts.length) cuts = e.frame.cuts;
      elevation = e.frame.sweep.elevation;
    }
  }
  return { frames, failed, cuts, elevation };
}

/** The older Level III code for the same moment: reflectivity and velocity before the super-res products. */
const OLDER_CODE: Record<string, string> = { B: "Q", G: "U" };

function L3Source({ product, site, tilt, frameCount, onFeed, until = null }: SourceProps) {
  const def = PRO_PRODUCTS[product];
  const code = l3CodeFor(product, tilt, until != null)!;
  const site3 = iemSiteId(site);
  const scaleId = def.kind === "l3" || def.kind === "site" ? (def.scale ?? "ref") : "ref";
  const letter = def.kind === "l3" ? def.letter : def.kind === "site" ? def.l3Letter : undefined;
  const spanMin = frameCount * 7 + 20;
  const list = useQuery({
    queryKey: ["pro-l3", site3, code, spanMin, until],
    queryFn: async ({ signal }) => {
      const since = (until ?? Date.now()) - spanMin * 60_000;
      const files = await listLevel3(site3, code, since, signal, until ?? undefined);
      // Before 2022 the archive has the 8-bit codes (N0Q, N0U) instead of the super-res ones (N0B, N0G).
      const older = until != null && !files.length ? OLDER_CODE[code[2]!] : undefined;
      if (older) return { code: code.slice(0, 2) + older, files: await listLevel3(site3, code.slice(0, 2) + older, since, signal, until ?? undefined) };
      return { code, files };
    },
    // The past doesn't change.
    refetchInterval: until != null ? false : 60_000,
    staleTime: until != null ? Infinity : 30_000,
    retry: 1,
  });
  const jobs = useMemo(
    () => newest(list.data?.files ?? [], frameCount).map((f) => ({ time: f.time, job: { kind: "l3", url: f.url, scale: scaleId } as DecodeJob })),
    [list.data, frameCount, scaleId],
  );
  const { palette, scale } = useDecodedScale(scaleId);
  const { frames, failed, elevation } = useDecodedFrames(jobs, scaleId, palette);
  // Nominal angles, except the shown tilt's actual one (it varies with the scan pattern).
  const tilts = useMemo(() => (letter ? tiltsFor(letter).map((x) => (x.prefix === tilt && elevation != null ? { ...x, angle: elevation } : x)) : noTilts), [letter, tilt, elevation]);
  const shown = tilts.find((x) => x.prefix === tilt) ?? null;
  useReport(onFeed, {
    frames,
    family: def.kind === "site" ? def.family : null,
    tilts,
    tilt: shown,
    source: `NOAA Level III ${site3} ${list.data?.code ?? code}`,
    loading: list.isLoading || (jobs.length > 0 && !frames.length && failed < jobs.length),
    empty: list.isError || (list.isSuccess && !jobs.length) || (jobs.length > 0 && failed === jobs.length),
    scale,
    decoded: true,
    scaleId,
  });
  return null;
}

function VolumeSource({ product, site, elev, frameCount, onFeed, until = null }: SourceProps) {
  const def = PRO_PRODUCTS[product];
  const moment = def.kind === "l2" ? def.moment : "REF";
  const scaleId = def.kind === "l2" ? def.scale : "ref";
  const count = Math.min(frameCount, 6);
  const spanMin = count * 7 + 30;
  const list = useQuery({
    queryKey: ["pro-l2", site, spanMin, until],
    queryFn: ({ signal }) => listLevel2(site, (until ?? Date.now()) - spanMin * 60_000, signal, until ?? undefined),
    refetchInterval: until != null ? false : 90_000,
    staleTime: until != null ? Infinity : 45_000,
    retry: 1,
  });
  // Live, the volumes the archive bucket doesn't have yet (it publishes each about 11 minutes after
  // the scan starts) come from the real-time chunks, the newest one as it's being scanned.
  const chunked = useQuery({
    queryKey: ["pro-l2-live", site],
    queryFn: ({ signal }) => liveVolumes(site, 3, signal),
    enabled: until == null,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1,
  });
  // Volumes from before 2008 don't say where the radar is.
  const where = getSite(site);
  const at = useMemo(() => (where ? { lat: where.lat, lon: where.lon } : undefined), [where]);
  const jobs = useMemo(() => {
    const files = list.data ?? [];
    const lastFile = files.at(-1)?.time ?? 0;
    const archived = files.map((f) => ({ time: f.time, job: { kind: "l2", url: f.url, moment, angle: elev, scale: scaleId, site: at } as DecodeJob }));
    const live = (until == null ? (chunked.data ?? []) : [])
      .filter((v) => v.time > lastFile + 30_000)
      .map((v) => ({ time: v.time, job: liveJob({ kind: "l2chunks", urls: v.urls, moment, angle: elev, scale: scaleId }) }));
    return [...archived, ...live].slice(-count);
  }, [list.data, chunked.data, until, count, moment, elev, scaleId, at]);
  const realTime = jobs.some((j) => j.job.kind === "l2chunks");
  const { palette, scale } = useDecodedScale(scaleId);
  const { frames, failed, cuts, elevation } = useDecodedFrames(jobs, scaleId, palette);
  const elevations = useMemo(() => [...new Set(cuts.map((c) => Math.round(c * 10) / 10))].sort((a, b) => a - b), [cuts]);
  // Memoised like every other field of the feed: a new object each render would re-report it forever.
  const tilt = useMemo<ResolvedTilt | null>(() => (elevation != null ? { prefix: "N0", angle: elevation, code: moment } : null), [elevation, moment]);
  const allFailed = jobs.length > 0 && failed === jobs.length;
  useReport(onFeed, {
    frames,
    family: null,
    tilts: noTilts,
    tilt,
    elevations,
    source: realTime ? `NOAA Level II ${site}, real time` : `NOAA Level II ${site}`,
    loading: list.isLoading || (jobs.length > 0 && !frames.length && !allFailed),
    empty: list.isError || (list.isSuccess && !jobs.length) || allFailed,
    note: allFailed && elevations.length ? "This tilt isn't in the radar's current scan pattern" : undefined,
    scale,
    decoded: true,
    scaleId,
  });
  return null;
}

function ServerSource({ product, frameCount, onFeed }: SourceProps) {
  const base = PRO_SERVER;
  const def = PRO_PRODUCTS[product];
  const id = def.kind === "server" ? def.serverId : "";
  const index = useQuery({
    queryKey: ["pro-server", base],
    queryFn: ({ signal }) => fetchServerIndex(base, signal),
    enabled: !!base,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const p = index.data?.products[id];
  const frames = useMemo(() => (p ? serverFrames(base, id, p, frameCount) : []), [p, base, id, frameCount]);
  const scale = useMemo<ValueScale | null>(() => (p?.legend?.stops?.length ? { stops: p.legend.stops, unit: p.legend.unit, decimals: p.legend.decimals ?? 1 } : null), [p]);
  useReport(onFeed, {
    frames,
    family: null,
    tilts: noTilts,
    tilt: null,
    source: base ? `Pro data server` : "",
    loading: !!base && index.isLoading,
    empty: !base || index.isError || (index.isSuccess && !frames.length),
    note: index.isError ? "Pro data server unreachable" : undefined,
    scale,
  });
  return null;
}

function MosaicSource({ frameCount, onFeed, until = null }: SourceProps) {
  const loop = useRadarLoop({ site: null, product: "N0Q", frameCount, speed: 1, crossfade: false, autoplay: false, archiveEnd: until });
  useReport(onFeed, {
    frames: loop.frames,
    family: "reflectivity",
    tilts: noTilts,
    tilt: null,
    source: loop.sourceLabel ? `NOAA ${loop.sourceLabel}` : "IEM national mosaic",
    loading: loop.isLoading,
    empty: !loop.isLoading && !loop.frames.length,
  });
  return null;
}

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

/** Another country's radar composite: its newest scans (the loop clock time-matches them to the other panes). */
function IntlSource({ product, frameCount, onFeed }: SourceProps) {
  const def = PRO_PRODUCTS[product];
  const r = INTL_RADARS[def.kind === "intl" ? def.source : "eccc"];
  const [q] = useIntlTimes([r.id], Math.min(250, frameCount * r.stepMin + 20));
  const list = q?.data?.times;
  const frames = useMemo(() => (list ?? []).slice(-frameCount).map((t) => intlFrame(r, t)), [list, frameCount, r]);
  useReport(onFeed, {
    frames,
    family: null,
    tilts: noTilts,
    tilt: null,
    source: r.agency,
    loading: !q || q.isLoading,
    empty: !!q && (q.isError || (q.isSuccess && !frames.length)),
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

/**
 * Looking back before Level III's archive: a radar's reflectivity or velocity
 * from its Level II volume instead (desktop), at the tilt the panel picked.
 */
function VolumeTiltSource(props: SourceProps & { volume: "vol-ref" | "vol-vel" }) {
  const { onFeed, tilt, product, volume } = props;
  const def = PRO_PRODUCTS[product];
  const family = def.kind === "site" ? def.family : null;
  const tilts = useMemo(() => TILTS.map((x) => ({ ...x, code: "L2" })), []);
  const shown = tilts.find((x) => x.prefix === tilt) ?? tilts[0]!;
  const relay = useCallback((f: PaneFeed) => onFeed({ ...f, family, tilts, tilt: shown, elevations: undefined }), [onFeed, family, tilts, shown]);
  return <VolumeSource {...props} product={volume} elev={shown.angle} onFeed={relay} />;
}

/** A product with nothing at the archive's time: says why. */
function Unarchived({ note, onFeed }: SourceProps & { note: string }) {
  useReport(onFeed, { frames: noFrames, family: null, tilts: noTilts, tilt: null, source: "", loading: false, empty: true, note });
  return null;
}
const noFrames: RadarFrame[] = [];

/** Picks the loader for a product; renders nothing. */
export function FrameSource(sourceProps: SourceProps) {
  const until = useAppStore((s) => s.archiveAt);
  const props = { ...sourceProps, until };
  const def = PRO_PRODUCTS[props.product];
  const note = until != null ? archiveNote(props.product, until) : null;
  // Keyed so switching products (or between live and the archive) starts from a clean loader.
  // Products this device can't show never reach here (see `shownProduct`).
  const when = until ?? "live";
  if (note && def.kind === "site" && props.caps.volume && (def.family === "reflectivity" || def.family === "velocity")) {
    const volume = def.family === "velocity" ? "vol-vel" : "vol-ref";
    return <VolumeTiltSource key={`l2t-${props.product}-${props.site}-${when}`} {...props} volume={volume} />;
  }
  if (note) return <Unarchived key={`none-${props.product}`} {...props} note={note} />;
  if (def.kind === "l2") return <VolumeSource key={`l2-${props.product}-${props.site}-${when}`} {...props} />;
  if (l3CodeFor(props.product, props.tilt, until != null)) return <L3Source key={`l3-${props.product}-${props.site}-${props.tilt}-${when}`} {...props} />;
  if (def.kind === "site") return <SiteSource key={`site-${props.product}-${props.site}`} {...props} />;
  if (def.kind === "server") return <ServerSource key={`srv-${props.product}`} {...props} />;
  if (def.kind === "mosaic") return <MosaicSource key={`mosaic-${when}`} {...props} />;
  if (def.kind === "mrms") return <MrmsSource key={`mrms-${props.product}`} {...props} />;
  if (def.kind === "intl") return <IntlSource key={`intl-${props.product}`} {...props} />;
  return <SatelliteSource key={`sat-${props.product}`} {...props} />;
}
