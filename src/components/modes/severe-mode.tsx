"use client";

import type { Map as MlMap } from "maplibre-gl";
import { ChevronLeft, CircleAlert, History, Layers, PanelLeftClose, Pause, PenLine, Play, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import { CATEGORIES, type PostDto } from "@/lib/community";
import { stormTitle } from "@/lib/feeds/tropical-parse";
import { distanceToGeometryKm, geometryContains, type BBox } from "@/lib/geo";
import { eventName } from "@/lib/i18n/nws-events";
import { useT } from "@/lib/i18n/use-t";
import { FAMILIES, familiesAvailable, resolveTilts, siteProducts } from "@/lib/radar/products";
import { iemSiteId } from "@/lib/radar/frames";
import { satelliteLabel, satelliteTimes } from "@/lib/radar/satellite";
import { getSite, nearestSites } from "@/lib/radar/site-utils";
import { useChasers, useChaserStreams, useForecast, useWebcams, useLocalAlerts, useOutlook, useRadarProducts, useReportsInView, useStormCells, useStormReports, useTropical } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useMapAlerts } from "@/hooks/use-map-alerts";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsDesktop, useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useRadarLoop } from "@/hooks/use-radar-loop";
import { liveFor, liveIndex, type LiveChaserStream } from "@/lib/chaser-streams";
import { COMMUNITY_ENABLED, IS_STATIC_BUNDLE } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { useDrawStore } from "@/store/draw-store";
import { ChaserDetail } from "../community/chaser-detail";
import { ChaserStreams } from "../radar/chaser-streams";
import { WebcamDetail, WebcamList } from "../radar/webcam-detail";
import { PostCard } from "../community/post-card";
import { MapView } from "../map/map-view";
import { MapStyleControls } from "../map/map-style-controls";
import { OutlookLayer } from "../map/layers/outlook-layer";
import { LightningLayer } from "../map/layers/lightning-layer";
import { RadarLayer } from "../map/layers/radar-layer";
import { SatelliteLayer, type SatelliteImage } from "../map/layers/satellite-layer";
import { SatelliteMapLayer } from "../map/layers/satellite-map-layer";
import { GisLayers } from "../map/layers/gis-layers";
import { StormCellsLayer } from "../map/layers/storm-cells-layer";
import { StormReportsLayer } from "../map/layers/storm-reports-layer";
import { TropicalLayer } from "../map/layers/tropical-layer";
import { ReportsLayer } from "../map/layers/reports-layer";
import { ChasersLayer } from "../map/layers/chasers-layer";
import { WebcamsLayer } from "../map/layers/webcams-layer";
import { SitesLayer } from "../map/layers/sites-layer";
import { StormPathLayer } from "../map/layers/storm-path-layer";
import { UserMarker } from "../map/layers/user-marker";
import { WarningsLayer } from "../map/layers/warnings-layer";
import { IntlRadarLayers } from "../map/layers/intl-radar-layer";
import { AlertDetail } from "../radar/alert-detail";
import { ArchivePicker, ArchiveStrip } from "../radar/archive-picker";
import { AlertList, alertUntil, HazardSwatch, type RankedAlert } from "../radar/alert-list";
import { WarningSquares } from "../radar/warning-squares";
import { reportsInAlert, type AlertReports } from "@/lib/alert-reports";
import { Segmented } from "../ui/segmented";
import { BroadcastStage } from "../broadcast/broadcast-stage";
import { DrawCanvas, DrawToolbar } from "../draw/draw-tools";
import { DrawingLayer } from "../draw/drawing-layer";
import { LiveDrawingLayer, useLiveDrawingPublisher, usePresenter } from "../draw/live-drawing";
import { ExportLoopButton } from "../radar/export-loop-dialog";
import { OutlookLegend } from "../radar/outlook-legend";
import { RadarControls } from "../radar/radar-controls";
import { RadarLegend } from "../radar/radar-legend";
import { frameTimeLabel, RadarTimeline } from "../radar/radar-timeline";
import { StormCellDetail, StormCellList, StormReportDetail, StormReportsList } from "../radar/storm-detail";
import { TropicalDetail } from "../radar/tropical-detail";
import { TropicalList } from "../radar/tropical-list";
import { Button, IconButton } from "../ui/button";
import { ErrorNote } from "../ui/misc";
import { Sheet, type Detent } from "../ui/sheet";
import { Tabs } from "../ui/tabs";

type PanelTab = "alerts" | "storms" | "radar" | "chasers";
/** What's selected on the map: a warning, a spotter post, an NWS storm report, a radar cell, a tropical cyclone or a storm chaser (by username). */
type Selection = { kind: "alert" | "post" | "lsr" | "cell" | "storm" | "chaser" | "cam"; id: string };
/** Hours of NWS storm reports on the map. */
const LSR_HOURS = 6;
type Padding = { top: number; right: number; bottom: number; left: number };
type Bounds = [[number, number], [number, number]];

/** Visible height of the phone sheet when collapsed; the transport docks just above it. */
const PEEK = 76;
/** Width of the floating selection column; it only floats at >= 1024 px, where it is `w-[380px]`. */
const DETAIL_W = 380;
/** Space between overlays, and between overlays and the map edge. */
const GAP = 12;
/** Viewports this short (phone landscape) get the compact transport and a collapsed panel. */
const SHORT_QUERY = "(max-height: 520px)";

/** PostCard draws its own panel; flatten it when it sits inside another surface. */
const EMBED_POST = "[&>article]:rounded-none [&>article]:border-0 [&>article]:bg-transparent";

const appear = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

/** A translated template with React nodes in its `{placeholders}` (styled text inside a sentence). */
function rich(text: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return text.split(/\{(\w+)\}/g).map((s, i) => (i % 2 ? <Fragment key={i}>{parts[s] ?? `{${s}}`}</Fragment> : s));
}

const samePadding = (a: Partial<Padding>, b: Padding) => (a.top ?? 0) === b.top && (a.right ?? 0) === b.right && (a.bottom ?? 0) === b.bottom && (a.left ?? 0) === b.left;

/** Shrink padding pairs that would leave less than ~35% of the map (min 160 px) to frame things in. */
function clampPadding(p: Padding, w: number, h: number): Padding {
  const fit = (a: number, b: number, size: number): [number, number] => {
    const max = size - Math.min(size, Math.max(160, size * 0.35));
    if (a + b <= max) return [a, b];
    const k = Math.max(0, max / (a + b));
    return [Math.round(a * k), Math.round(b * k)];
  };
  const [left, right] = fit(p.left, p.right, w);
  const [top, bottom] = fit(p.top, p.bottom, h);
  return { top, right, bottom, left };
}

/** Border-box height of an element that may mount late or move between parents. */
function useHeight<T extends HTMLElement>() {
  const [height, setHeight] = useState(0);
  const ref = useCallback((el: T | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = Math.round(entry?.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight);
      setHeight((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, height] as const;
}

/**
 * Layout (all overlays are positioned inside the map, which the shell sizes
 * between the top bar and the phone tab bar):
 * - Desktop (>= 1024 px wide and >= 600 px tall): warnings/layers side panel at
 *   the left, selection details floating at the top right, legend + transport
 *   docked at the bottom between them.
 * - Tablet and phone landscape: the same side panel, which also shows the
 *   selection. Short screens get a one-row transport with an inline legend,
 *   and the panel starts collapsed.
 * - Phones: one bottom sheet (peek / half / full) holds warnings, layers and
 *   selection details. The transport, with a slim legend strip, rides on top
 *   of the sheet; MapLibre's controls move to the top right.
 * MapLibre's camera padding tracks the overlays, so centring and framing use
 * the part of the map that is actually visible.
 */
export function SevereMode({ studio }: { studio?: { onExit: () => void } } = {}) {
  const t = useT();
  const loc = useAppStore((s) => s.location);
  const radar = useAppStore((s) => s.radar);
  const setRadar = useAppStore((s) => s.setRadar);
  const radiusKm = useAppStore((s) => s.radiusKm);
  const placeName = loc.name === "My location" ? t(loc.name) : loc.name;
  // Looking back at the archive: that moment stands in for now everywhere on this screen.
  const archiveAt = useAppStore((s) => s.archiveAt);
  const archived = archiveAt != null;
  const liveNow = useNow(30_000);
  const now = archiveAt ?? liveNow;
  /** Only what has an archive: the national mosaic, warnings and storm reports. */
  const layers = archived
    ? { ...radar, satellite: "off" as const, showOutlook: false, showReports: false, showCells: false, showTropical: false, showChasers: false, showCams: false, showLightning: false, showSites: false, intlRadar: false }
    : radar;
  const fmt = useFormat();
  // Times (warning expiry, radar frames) read in the selected location's zone, like the rest of the app.
  const timeZone = useForecast().data?.timezone;
  const desktop = useIsDesktop();
  const wide = useMediaQuery("(min-width: 1024px)");
  /** Selection details float beside the panel only where they fit; elsewhere they replace the list. */
  const floatDetail = useMediaQuery("(min-width: 1024px) and (min-height: 600px)");
  const short = useMediaQuery(SHORT_QUERY);
  const [map, setMap] = useState<MlMap | null>(null);
  /** Desktop only: the side panel can be hidden (and starts hidden on short screens). On phones the sheet's peek is the collapsed state. */
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || !window.matchMedia(SHORT_QUERY).matches);
  const [tab, setTab] = useState<PanelTab>("alerts");
  const [detent, setDetent] = useState<Detent>("peek");
  const [sheetHeights, setSheetHeights] = useState<Record<Detent, number> | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const selectedId = (kind: Selection["kind"]) => (sel?.kind === kind ? sel.id : null);
  const selectedAlert = selectedId("alert");
  const [satImage, setSatImage] = useState<SatelliteImage | null>(null);
  const [bbox, setBbox] = useState<BBox | null>(null);
  const intlView = useMemo<[number, number, number, number] | null>(() => (bbox ? [bbox.west, bbox.south, bbox.east, bbox.north] : null), [bbox]);
  /** A request to frame bounds; `n` makes repeat requests for the same bounds distinct. */
  const [fitRequest, setFitRequest] = useState<{ bounds: Bounds; n: number } | null>(null);
  const fitDone = useRef(0);
  const [dockRef, dockH] = useHeight<HTMLDivElement>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Broadcast mode: the map full screen with on-air graphics (components/broadcast). Only on its own
  // page (/broadcast), so nobody opening the radar lands in it.
  const broadcasting = !!studio;
  // Drawing on the map (a telestrator), optionally on the live stream.
  const drawOpen = useDrawStore((s) => s.open);
  const setDrawOpen = useDrawStore((s) => s.setOpen);
  const drawShapes = useDrawStore((s) => s.shapes);
  const presenter = usePresenter();
  const airStatus = useLiveDrawingPublisher(presenter);
  const drawButton = (
    <IconButton size="sm" label={t("Draw on the map")} aria-pressed={drawOpen} onClick={() => setDrawOpen(!drawOpen)}>
      <PenLine className="size-4" aria-hidden />
    </IconButton>
  );
  const panelW = short ? 280 : wide ? 340 : 300;

  // ── Radar product resolution (driven by what IEM actually has) ────────────
  // The archive has no single-site tiles (Professional mode has the radars' own volumes).
  const isSite = radar.source === "site" && !archived;
  const site = isSite ? (getSite(radar.site) ?? nearestSites(loc, 1)[0]!) : null;
  // What the site (or, on the mosaic, the nearest one a product button switches to) actually has.
  const productSite = site ?? nearestSites(loc, 1)[0]!;
  const products = useRadarProducts(iemSiteId(productSite.icao));
  const available = useMemo(() => siteProducts(productSite.icao, products.data?.products), [productSite.icao, products.data]);
  // A saved product the site no longer has (dual-pol that IEM stopped publishing) falls back to reflectivity.
  const radarFamily = familiesAvailable(available).includes(radar.family) ? radar.family : "reflectivity";
  const tilts = isSite ? resolveTilts(radarFamily, available) : [];
  const tilt = tilts.find((x) => x.prefix === radar.tilt) ?? tilts[0];
  const productCode = isSite ? (tilt?.code ?? `N0${FAMILIES[radarFamily].letters[0]}`) : "N0Q";

  const loop = useRadarLoop({
    site: site?.icao ?? null,
    product: productCode,
    frameCount: radar.frames,
    speed: radar.speed,
    crossfade: radar.crossfade,
    futureHours: radar.future && !isSite ? 6 : 0,
    historyMinutes: radar.history === "4h" ? 240 : radar.history === "2h" ? 120 : 0,
    // Extrapolating velocity or dual-pol means nothing: reflectivity only.
    nowcast: { map, enabled: radar.nowcast && (!isSite || radarFamily === "reflectivity") },
    archiveEnd: archiveAt,
  });
  const showingForecast = !!loop.frames[loop.index]?.forecast;
  const showingNowcast = !!loop.frames[loop.index]?.nowcast;
  // Other countries' radar is matched to the loop's observed scans (forecast frames get none).
  const loopTimes = useMemo(() => loop.frames.map((f) => (f.forecast ? Number.NaN : f.time)), [loop.frames]);
  // So is the satellite loop (there's no imagery of the future): it holds the newest scan's image while forecast frames play.
  const satLoop = satelliteTimes(loop.frames, loop.index, now);

  // ── Overlays ──────────────────────────────────────────────────────────────
  // Storm-based warnings plus the watches, advisories, discussions… picked in the layer settings.
  const { national, hazards, spotter, all: mapAlerts } = useMapAlerts();
  const local = useLocalAlerts();
  // The location's own zone alerts are today's.
  const localAlerts = useMemo(() => (archived ? [] : (local.data?.alerts ?? [])), [archived, local.data]);
  const outlook = useOutlook(layers.showOutlook, radar.outlookKind);
  const reports = useReportsInView(bbox, layers.showReports);
  // Also feeds the spotter reports shown on each warning.
  const lsr = useStormReports(true, LSR_HOURS, archiveAt);
  const cells = useStormCells(layers.showCells);
  const tropical = useTropical(layers.showTropical);
  const chasers = useChasers(layers.showChasers);
  const lsrList = useMemo(() => lsr.data?.reports ?? [], [lsr.data]);
  const cellList = useMemo(() => cells.data?.cells ?? [], [cells.data]);
  const storms = useMemo(() => tropical.data?.storms ?? [], [tropical.data]);
  const chaserList = useMemo(() => chasers.data?.chasers ?? [], [chasers.data]);
  const webcams = useWebcams(layers.showCams);
  const camList = useMemo(() => webcams.data ?? [], [webcams.data]);
  // Live storm chaser streams: the Chasers tab, and LIVE on the chasers layer.
  const streams = useChaserStreams(tab === "chasers" || layers.showChasers);
  const liveByKey = useMemo(() => liveIndex(streams.data?.live ?? []), [streams.data]);
  const liveOf = (c: { stream: Parameters<typeof liveFor>[0] }) => liveFor(c.stream, liveByKey);
  const chaserForStream = (s: LiveChaserStream) => chaserList.find((c) => liveOf(c)?.videoId === s.videoId) ?? null;

  const ranked = useMemo<RankedAlert[]>(() => {
    const out = new Map<string, RankedAlert>();
    for (const a of national.data?.alerts ?? []) {
      if (!a.geometry) continue;
      const inside = geometryContains(a.geometry, loc);
      const d = inside ? 0 : distanceToGeometryKm(a.geometry, loc);
      if (d <= radiusKm) out.set(a.id, { alert: a, distanceKm: d, inside });
    }
    for (const a of localAlerts) if (!out.has(a.id)) out.set(a.id, { alert: a, distanceKm: 0, inside: true });
    return [...out.values()].sort((x, y) => Number(y.inside) - Number(x.inside) || y.alert.rank - x.alert.rank || x.distanceKm - y.distanceKm);
  }, [national.data, localAlerts, loc, radiusKm]);

  const allAlerts = useMemo(() => [...(national.data?.alerts ?? []), ...localAlerts, ...hazards, ...spotter], [national.data, localAlerts, hazards, spotter]);
  const alertById = (id: string | null) => (id ? allAlerts.find((a) => a.id === id) : undefined);
  const activeAlert = alertById(selectedAlert);
  const activeReport = (reports.data ?? []).find((p) => p.id === selectedId("post"));
  const activeLsr = lsrList.find((r) => r.id === selectedId("lsr"));
  const activeCell = cellList.find((c) => c.id === selectedId("cell"));
  const activeStorm = storms.find((s) => s.id === selectedId("storm"));
  const activeChaser = layers.showChasers ? chaserList.find((c) => c.username === selectedId("chaser")) : undefined;
  const activeCam = layers.showCams ? camList.find((c) => c.id === selectedId("cam")) : undefined;

  // ── Selection ─────────────────────────────────────────────────────────────
  /** Without the floating column, details show in the panel/sheet: switch to warnings and reveal it. */
  const revealSelection = (next: PanelTab) => {
    if (floatDetail) return;
    setTab(next);
    if (desktop) setPanelOpen(true);
    else setDetent((d) => (d === "full" ? "full" : "half"));
  };
  const openSheet = (next: PanelTab) => {
    setTab(next);
    setDetent((d) => (d === "peek" ? "half" : d));
  };
  const select = (kind: Selection["kind"], id: string) => {
    setSel({ kind, id });
    revealSelection(kind === "alert" || kind === "post" || kind === "chaser" ? "alerts" : "storms");
  };
  const selectAlert = (id: string) => select("alert", id);
  const clearSelection = () => setSel(null);
  /** Select something on the map and centre it. */
  const focusPoint = (kind: Selection["kind"], id: string, lon: number, lat: number) => {
    select(kind, id);
    const d = 0.6;
    setFitRequest((r) => ({ bounds: [[lon - d, lat - d], [lon + d, lat + d]], n: (r?.n ?? 0) + 1 }));
  };

  /** An archived storm: frame where it was. */
  const showEvent = (e: { lat: number; lon: number }) => {
    const d = 1.2;
    setFitRequest((r) => ({ bounds: [[e.lon - d, e.lat - d], [e.lon + d, e.lat + d]], n: (r?.n ?? 0) + 1 }));
    setArchiveOpen(false);
  };

  /** Select a warning and frame its polygon (the camera effect below applies it once the layout settles). */
  const focusAlert = (a: WeatherAlert) => {
    selectAlert(a.id);
    if (!a.geometry) return;
    const coords = (a.geometry.type === "Polygon" ? a.geometry.coordinates.flat() : a.geometry.coordinates.flat(2)) as [number, number][];
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const bounds: Bounds = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
    setFitRequest((r) => ({ bounds, n: (r?.n ?? 0) + 1 }));
  };

  useHotkeys({
    " ": (e) => {
      e.preventDefault();
      loop.toggle();
    },
    ArrowLeft: () => loop.step(-1),
    ArrowRight: () => loop.step(1),
    Escape: clearSelection,
  });

  const family = isSite ? radarFamily : "reflectivity";

  // ── Legend caption: where the data comes from ─────────────────────────────
  // With NOAA as the source, say so and how fresh its newest scan is.
  const newestScan = loop.liveCount > 0 ? loop.frames[loop.liveCount - 1]?.time : undefined;
  const scanAge = newestScan ? Math.max(0, Math.round((now - newestScan) / 60_000)) : null;
  const noaaTag = loop.sourceLabel
    ? scanAge == null
      ? `NOAA ${loop.sourceLabel}`
      : scanAge < 1
        ? t("NOAA {source} · updated now", { source: loop.sourceLabel })
        : t("NOAA {source} · updated {n} min ago", { source: loop.sourceLabel, n: scanAge })
    : null;
  const caption =
    isSite && site ? (
      <>
        <span className="shrink-0 font-mono">{noaaTag ?? `${site.icao} ${productCode}`}</span>
        <span className="min-w-0 truncate">{showingNowcast ? t("Extrapolated, not observed") : `${site.place}, ${site.state}`}</span>
      </>
    ) : (
      <>
        <span className="shrink-0 font-mono">{showingNowcast ? t("Future") : showingForecast ? "HRRR" : (noaaTag ?? loop.product)}</span>
        <span className="min-w-0 truncate">
          {t(
            showingNowcast
              ? "Extrapolated, not observed"
              : showingForecast
                ? "Model forecast, not observed"
                : loop.usingFallback
                  ? "Mosaic (rolling)"
                  : loop.source === "noaa"
                    ? "Multi-radar national mosaic, 1 km"
                    : "National mosaic",
          )}
        </span>
      </>
    );

  const satCaption = layers.satellite !== "off" && satImage ? satelliteLabel(satImage.band, satImage.slotMs, timeZone, satImage.sat, t) : null;

  // ── Sheet header ──────────────────────────────────────────────────────────
  const where = (r: RankedAlert) =>
    r.inside
      ? t("Over your location, until {time}", { time: alertUntil(r.alert, timeZone, t.locale) })
      : t("{distance} away, until {time}", { distance: fmt.distanceKm(r.distanceKm), time: alertUntil(r.alert, timeZone, t.locale) });
  const top = ranked[0];
  const hasSelection = !!(activeAlert || activeReport || activeLsr || activeCell || activeStorm || activeChaser || activeCam);
  /** The selection replaces the list (and the tabs) in the panel/sheet. */
  const inlineSelection = !floatDetail && hasSelection && tab !== "radar";

  // ── Camera: keep MapLibre's padding in sync with the overlays ─────────────
  // Centring (initial view, location changes) and framing then use the part
  // of the map the panel, sheet, details and transport leave visible.
  const padding = useMemo<Padding>(() => {
    // On air nothing covers the map.
    if (broadcasting) return { top: 0, left: 0, right: 0, bottom: 0 };
    if (desktop) {
      return {
        top: 0,
        left: panelOpen ? GAP + panelW : 0,
        right: floatDetail && hasSelection ? GAP + DETAIL_W : 0,
        bottom: dockH ? 16 + dockH : 0,
      };
    }
    // At the full detent the map is covered anyway; keep the half layout.
    const sheet = sheetHeights?.[detent === "full" ? "half" : detent] ?? PEEK;
    return { top: 8, left: 0, right: 0, bottom: sheet + (dockH ? 8 + dockH : 0) };
  }, [broadcasting, desktop, panelOpen, panelW, floatDetail, hasSelection, dockH, sheetHeights, detent]);

  useEffect(() => {
    if (!map) return;
    // Wait a frame so layout changes that land together (selection, sheet
    // detent, measured dock) become one camera move, not several that cut
    // each other off.
    const id = requestAnimationFrame(() => {
      const el = map.getContainer();
      const pad = clampPadding(padding, el.clientWidth, el.clientHeight);
      if (fitRequest && fitRequest.n !== fitDone.current) {
        fitDone.current = fitRequest.n;
        // Fit inside the padded area with a 32 px margin, then animate camera and padding together.
        const margin = { top: pad.top + 32, right: pad.right + 32, bottom: pad.bottom + 32, left: pad.left + 32 };
        const cam =
          map.cameraForBounds(fitRequest.bounds, { padding: margin, absolutePadding: true, maxZoom: 9 }) ??
          map.cameraForBounds(fitRequest.bounds, { padding: pad, absolutePadding: true, maxZoom: 9 });
        if (cam?.center) {
          map.flyTo({ center: cam.center, zoom: cam.zoom, padding: pad, duration: 900, essential: true });
          return;
        }
      }
      if (!samePadding(map.getPadding(), pad)) map.easeTo({ padding: pad, duration: 250 });
    });
    return () => cancelAnimationFrame(id);
  }, [map, padding, fitRequest]);

  const selectionTitle = activeAlert
    ? eventName(t.lang, activeAlert.event)
    : activeLsr
      ? t("Storm report")
      : activeCell
        ? t("Radar storm cell")
        : activeStorm
          ? stormTitle(activeStorm.classification, activeStorm.name, t)
          : activeChaser
            ? t("Storm chaser")
            : activeCam
              ? activeCam.name
              : t("Spotter report");

  // Phone peek: one useful line — the selection, else the highest-ranked warning nearby.
  let peek: { color: string | null; title: string; sub: string };
  if (activeAlert) {
    const r = ranked.find((x) => x.alert.id === activeAlert.id);
    peek = { color: activeAlert.color, title: eventName(t.lang, activeAlert.event), sub: r ? where(r) : t("Until {time}", { time: alertUntil(activeAlert, timeZone, t.locale) }) };
  } else if (activeReport) {
    const cat = CATEGORIES[activeReport.category] ?? CATEGORIES.observation;
    peek = { color: null, title: t("Spotter report"), sub: activeReport.place ? `${t(cat.label)}, ${activeReport.place}` : t(cat.label) };
  } else if (activeChaser) {
    peek = { color: null, title: selectionTitle, sub: activeChaser.displayName };
  } else if (activeCam) {
    peek = { color: null, title: activeCam.name, sub: t("Live camera") };
  } else if (activeLsr || activeCell || activeStorm) {
    peek = { color: null, title: selectionTitle, sub: t("Tap for details") };
  } else if (top) {
    peek = { color: top.alert.color, title: eventName(t.lang, top.alert.event), sub: where(top) };
  } else if (national.isLoading) {
    peek = { color: null, title: t("Loading warnings"), sub: t("NWS active alerts") };
  } else if (national.error) {
    peek = { color: null, title: t("Warnings unavailable"), sub: t("NWS alerts could not be loaded") };
  } else {
    peek = { color: null, title: t("No warnings nearby"), sub: t("Within {distance} of {place}", { distance: fmt.distanceKm(radiusKm), place: placeName }) };
  }
  // Tapping the peek opens what it shows: the top warning's details, or the sheet.
  const onPeek = () => {
    if (!hasSelection && top) focusAlert(top.alert);
    else openSheet("alerts");
  };

  const peekHeader = (
    <div className="flex h-14 items-center gap-1 pr-2 pl-4">
      <button type="button" onClick={onPeek} className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left">
        {/* Aligned with the title line of the two-line (36 px) text block. */}
        {peek.color && <HazardSwatch color={peek.color} className="mt-4 self-start" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-5 font-semibold text-ink">{peek.title}</span>
          <span className="block truncate text-xs text-ink-3 tabular">{peek.sub}</span>
        </span>
        {!hasSelection && ranked.length > 1 && <span className="shrink-0 text-xs text-ink-3 tabular">{t.plural(ranked.length, "{n} warning", "{n} warnings")}</span>}
      </button>
      <IconButton label={t("Radar & layers")} onClick={() => openSheet("radar")}>
        <Layers className="size-5" aria-hidden />
      </IconButton>
    </div>
  );

  // Phones at the full detent: the transport on top of the sheet is off-screen,
  // so the header keeps play/pause and the frame time.
  const frameTime = frameTimeLabel(loop, timeZone, t);
  const headerTransport = !desktop && detent === "full" && (
    <div className="flex shrink-0 items-center gap-1">
      {frameTime && <span className="font-mono text-xs text-ink-3">{frameTime}</span>}
      <IconButton label={loop.playing ? t("Pause radar loop") : t("Play radar loop")} onClick={loop.toggle} disabled={loop.frames.length < 2}>
        {loop.playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
      </IconButton>
    </div>
  );
  const hidePanel = desktop && (
    <IconButton label={t("Hide panel")} size="sm" onClick={() => setPanelOpen(false)}>
      <PanelLeftClose className="size-4" aria-hidden />
    </IconButton>
  );

  const stormsTab = radar.showStormReports || layers.showCells || layers.showTropical || layers.showCams;
  const tabsHeader = (
    <div className="flex items-center justify-between gap-2 pr-1.5 pl-4">
      <Tabs<PanelTab>
        ariaLabel={t("Warnings and layers")}
        value={tab}
        onChange={setTab}
        items={[
          { value: "alerts", label: t("Warnings"), count: ranked.length },
          ...(stormsTab ? [{ value: "storms" as const, label: t("Storms") }] : []),
          { value: "radar", label: t("Layers") },
          // The live streams need the server, which the Android app doesn't have.
          ...(!IS_STATIC_BUNDLE ? [{ value: "chasers" as const, label: t("Chasers"), count: streams.data?.live.length }] : []),
        ]}
      />
      {hidePanel || headerTransport}
    </div>
  );

  // A single warning or report: back to the list, swatch and title. Replaces the tabs.
  const selectionHeader = (
    <div className="flex min-h-10 items-center gap-2 py-0.5 pr-1.5 pl-1">
      <IconButton label={t("Back to list")} onClick={clearSelection}>
        <ChevronLeft className="size-5" aria-hidden />
      </IconButton>
      {activeAlert && <HazardSwatch color={activeAlert.color} />}
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{selectionTitle}</h2>
      {hidePanel || headerTransport}
    </div>
  );

  // ── Sheet body ────────────────────────────────────────────────────────────
  const listPending = !ranked.length && (national.isLoading || !!national.error);
  const reportCache = new Map<string, AlertReports>();
  const reportsFor = (a: WeatherAlert) => {
    let r = reportCache.get(a.id);
    if (!r) reportCache.set(a.id, (r = reportsInAlert(a, lsrList, now)));
    return r;
  };
  const everyWarning = radar.warningsScope === "all";
  const squareItems = everyWarning
    ? [...(national.data?.alerts ?? [])].sort((x, y) => y.rank - x.rank || Date.parse(x.ends ?? x.expires) - Date.parse(y.ends ?? y.expires))
    : ranked.map((r) => r.alert);
  const warningsBody = (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        <Segmented
          ariaLabel={t("Warnings view")}
          size="sm"
          value={radar.warningsView}
          onChange={(warningsView) => setRadar({ warningsView })}
          options={[
            { value: "squares", label: t("Squares") },
            { value: "list", label: t("List") },
          ]}
        />
        {radar.warningsView === "squares" && (
          <Segmented
            ariaLabel={t("Which warnings")}
            size="sm"
            value={radar.warningsScope}
            onChange={(warningsScope) => setRadar({ warningsScope })}
            options={[
              { value: "nearby", label: t("Nearby") },
              { value: "all", label: national.data ? t("All US ({n})", { n: national.data.alerts.length }) : t("All US") },
            ]}
          />
        )}
      </div>
      {national.isLoading && <p className="label px-4 pt-3 pb-1">{t("Loading NWS warnings")}</p>}
      {national.error ? (
        <div className="px-4 pt-3 pb-1">
          <ErrorNote error={national.error} what="the NWS warnings" />
        </div>
      ) : null}
      {!listPending &&
        (radar.warningsView === "squares" ? (
          <WarningSquares
            items={squareItems}
            reportsFor={reportsFor}
            selectedId={selectedAlert}
            onSelect={focusAlert}
            now={now}
            timeZone={timeZone}
            emptyTitle={
              archived
                ? t("No warnings in effect then")
                : everyWarning
                  ? t("No active warnings in the US")
                  : t("No active warnings within {distance}", { distance: fmt.distanceKm(radiusKm) })
            }
          />
        ) : (
          <AlertList items={ranked} selectedId={selectedAlert} onSelect={focusAlert} timeZone={timeZone} />
        ))}
      {(radar.warningsView === "squares" ? squareItems.length : ranked.length) > 0 && (
        <p className="label border-t border-line px-4 py-3">
          {t(
            radar.warningsView !== "squares"
              ? "Within {distance} of {place}"
              : everyWarning
                ? "Every active NWS warning. Reports are NWS local storm reports from the last {n} hours (trained spotters, chasers, emergency managers)."
                : "Within {distance} of {place}. Reports are NWS local storm reports from the last {n} hours (trained spotters, chasers, emergency managers).",
            { distance: fmt.distanceKm(radiusKm), place: placeName, n: LSR_HOURS },
          )}
        </p>
      )}
    </>
  );

  // Without the floating column, a selection replaces the list (its header shows the title).
  const selectionBody = activeAlert ? (
    <AlertDetail alert={activeAlert} now={now} timeZone={timeZone} hideTitle className="p-4" reports={reportsFor(activeAlert)} />
  ) : activeReport ? (
    <div className={EMBED_POST}>
      <PostCard post={activeReport} now={now} />
    </div>
  ) : activeLsr ? (
    <StormReportDetail report={activeLsr} now={now} timeZone={timeZone} hideTitle className="p-4" />
  ) : activeCell ? (
    <StormCellDetail cell={activeCell} now={now} timeZone={timeZone} location={loc} hideTitle className="p-4" />
  ) : activeStorm ? (
    <TropicalDetail storm={activeStorm} timeZone={timeZone} className="p-4" />
  ) : activeChaser ? (
    <ChaserDetail chaser={activeChaser} live={liveOf(activeChaser)} fetchedAt={chasers.dataUpdatedAt} now={now} className="p-4" />
  ) : activeCam ? (
    <WebcamDetail cam={activeCam} location={loc} now={now} hideTitle className="p-4" />
  ) : null;

  const section = (title: string, pending: boolean, error: unknown, what: string, children: React.ReactNode) => (
    <section className="border-b border-line last:border-b-0">
      <h3 className="label px-4 pt-3 pb-1">{t(title, { n: LSR_HOURS })}</h3>
      {error ? (
        <div className="px-4 pb-3">
          <ErrorNote error={error} what={what} />
        </div>
      ) : pending ? (
        <p className="px-4 pb-3 text-xs text-ink-3">{t("Loading")}</p>
      ) : (
        children
      )}
    </section>
  );
  const stormsBody = (
    <>
      {layers.showCams &&
        section(
          "Live cameras nearby",
          webcams.isLoading,
          webcams.error,
          "the live cameras",
          <WebcamList cams={camList} location={loc} selectedId={selectedId("cam")} onSelect={(c) => focusPoint("cam", c.id, c.lon, c.lat)} />,
        )}
      {layers.showTropical &&
        section(
          "Tropical cyclones",
          tropical.isLoading,
          tropical.error,
          "the NHC storms",
          <TropicalList storms={storms} timeZone={timeZone} selectedId={selectedId("storm")} onSelect={(id) => {
            const storm = storms.find((x) => x.id === id);
            if (storm) focusPoint("storm", id, storm.lon, storm.lat);
          }} />,
        )}
      {layers.showCells &&
        section(
          "Radar storm cells",
          cells.isLoading,
          cells.error,
          "the NEXRAD storm cells",
          <StormCellList cells={cellList} now={now} location={loc} selectedId={selectedId("cell")} onSelect={(c) => focusPoint("cell", c.id, c.lon, c.lat)} />,
        )}
      {radar.showStormReports &&
        section(
          "Storm reports, last {n} h",
          lsr.isLoading,
          lsr.error,
          "the NWS storm reports",
          <StormReportsList reports={lsrList} hours={LSR_HOURS} now={now} timeZone={timeZone} selectedId={selectedId("lsr")} onSelect={(r) => focusPoint("lsr", r.id, r.lon, r.lat)} />,
        )}
    </>
  );

  // The radar's layers and the map style: the Radar tab, and Broadcast mode's layers menu.
  const layerControls = (
    <>
      <RadarControls settings={radar} onChange={setRadar} site={site} available={available} location={loc} />
      <section className="mt-5 space-y-4 border-t border-line pt-4">
        <h3 className="text-[13px] font-semibold text-ink">{t("Map style")}</h3>
        <MapStyleControls />
      </section>
    </>
  );
  const sheetBody =
    tab === "radar" ? (
      <div className="p-4">
        {archived && radar.source === "site" && (
          <p className="mb-4 text-xs text-ink-3">{t("Looking back shows the national mosaic. Professional mode has each radar's own scans.")}</p>
        )}
        {layerControls}
        <section className="mt-5 space-y-4 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold text-ink">{t("Radar archive")}</h3>
          <ArchivePicker timeZone={timeZone} onEvent={showEvent} />
        </section>
      </div>
    ) : inlineSelection ? (
      selectionBody
    ) : tab === "chasers" && !IS_STATIC_BUNDLE ? (
      <ChaserStreams
        data={streams.data}
        pending={streams.isLoading}
        error={streams.error}
        chaserFor={chaserForStream}
        onShowOnMap={(c) => {
          setRadar({ showChasers: true });
          focusPoint("chaser", c.username, c.lon, c.lat);
        }}
        now={now}
      />
    ) : tab === "storms" && stormsTab ? (
      stormsBody
    ) : (
      warningsBody
    );

  // ── Dock: legend + transport ──────────────────────────────────────────────
  // Desktop: legend card above the transport. Short screens: one row with an
  // inline legend. Phones: a legend strip inside the transport box, all of it
  // riding on top of the sheet.
  const legendCode = showingNowcast
    ? t("Extrapolated")
    : showingForecast && !isSite
      ? t("HRRR forecast")
      : (noaaTag ?? (isSite && site ? `${site.icao} ${productCode}` : loop.product));
  const sentenceCaseFamily = t(FAMILIES[family].label).toLowerCase();
  const loopTitle = isSite && site ? `${site.icao} ${sentenceCaseFamily}` : t("NEXRAD mosaic, {product}", { product: sentenceCaseFamily });
  const dock = (
    <div ref={dockRef} className="pointer-events-none flex flex-col items-start gap-2 [&>*]:pointer-events-auto">
      {desktop && !short && layers.showOutlook && (outlook.data?.features.length ?? 0) > 0 && (
        <OutlookLegend kind={radar.outlookKind} features={outlook.data?.features ?? []} />
      )}
      {desktop && !short && <RadarLegend family={family} caption={caption} />}
      {satCaption && <p className="overlay px-2.5 py-1 text-[11px] text-ink-3 tabular">{satCaption}</p>}
      {archiveOpen && (
        <div className="overlay w-full max-w-sm p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink">{t("Radar archive")}</h3>
            <IconButton size="sm" label={t("Close")} onClick={() => setArchiveOpen(false)}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
          <ArchivePicker timeZone={timeZone} onEvent={showEvent} />
        </div>
      )}
      <ArchiveStrip timeZone={timeZone} onPick={() => setArchiveOpen(true)} className="w-full max-w-sm" />
      {loop.error ? (
        <p role="status" className="overlay flex items-start gap-2 px-3 py-2 text-xs text-ink-2">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-nogo" aria-hidden />
          <span>
            {rich(t("Radar index unavailable for {product}. Try another product or site."), {
              product: (
                <span className="font-mono">
                  {site?.icao ?? t("mosaic")} {productCode}
                </span>
              ),
            })}
          </span>
        </p>
      ) : isSite && site && !loop.isLoading && loop.frames.length === 0 ? (
        <p role="status" className="overlay flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-xs text-ink-2">
          <span className="flex min-w-0 items-start gap-2">
            <CircleAlert className="mt-px size-3.5 shrink-0 text-caution" aria-hidden />
            <span>
              {rich(t("No recent scans from {site}. The radar may be down for maintenance."), { site: <span className="font-mono">{site.icao}</span> })}
            </span>
          </span>
          <Button size="sm" onClick={() => setRadar({ source: "mosaic", family: "reflectivity" })}>
            {t("Show national mosaic")}
          </Button>
        </p>
      ) : null}
      <div className="w-full">
        <RadarTimeline
          loop={loop}
          speed={radar.speed}
          onSpeed={(speed) => setRadar({ speed })}
          now={now}
          timeZone={timeZone}
          compact={short}
          showSpeed
          legend={!desktop ? <RadarLegend variant="strip" family={family} code={legendCode} /> : short ? <RadarLegend variant="inline" family={family} code={legendCode} /> : undefined}
          legendPosition={desktop ? "end" : "top"}
          actions={
            <>
              <IconButton size="sm" label={t("Radar archive")} onClick={() => setArchiveOpen((o) => !o)} aria-pressed={archiveOpen}>
                <History className="size-4" aria-hidden />
              </IconButton>
              {drawButton}
              <ExportLoopButton size="sm" map={map} loop={loop} speed={radar.speed} title={loopTitle} subtitle={placeName} timeZone={timeZone} />
            </>
          }
        />
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "absolute inset-0 bg-canvas",
        // Overlay insets that respect a landscape notch, and the side-panel width (keep in sync with `panelW`).
        "[--sl:max(12px,env(safe-area-inset-left))] [--sr:max(12px,env(safe-area-inset-right))]",
        short ? "[--panel-w:280px]" : "[--panel-w:300px] lg:[--panel-w:340px]",
        // MapLibre zoom/attribution: clear of the notch; on phones move them to the top right,
        // since the bottom of the map belongs to the sheet and the transport.
        "[&_.maplibregl-ctrl-bottom-right]:pr-[env(safe-area-inset-right)]",
        "max-md:[&_.maplibregl-ctrl-bottom-right]:top-3 max-md:[&_.maplibregl-ctrl-bottom-right]:bottom-auto",
      )}
    >
      <MapView center={loc} zoom={isSite ? 7.5 : 6} allow3d onViewChange={(b) => setBbox(b)} onReady={setMap}>
        {radar.satelliteMap && <SatelliteMapLayer />}
        {layers.satellite !== "off" && (
          <SatelliteLayer band={layers.satellite} times={satLoop.times} current={satLoop.current} onImage={setSatImage} />
        )}
        {layers.showOutlook && <OutlookLayer features={outlook.data?.features ?? []} kind={outlook.data?.kind ?? radar.outlookKind} />}
        {layers.showTropical && <TropicalLayer storms={storms} selectedId={selectedId("storm")} onSelect={(id) => select("storm", id)} />}
        {layers.showLightning && <LightningLayer />}
        <GisLayers />
        {layers.intlRadar && <IntlRadarLayers view={intlView} loopTimes={loopTimes} index={loop.index} opacity={radar.opacity} crossfadeMs={loop.crossfadeMs} />}
        <RadarLayer frames={loop.frames} index={loop.index} opacity={radar.opacity} crisp={(FAMILIES[family].crisp && isSite) || !radar.smooth} crossfadeMs={loop.crossfadeMs} onStatus={loop.onStatus} />
        {radar.showWarnings && (
          <WarningsLayer
            alerts={mapAlerts}
            selectedId={selectedAlert}
            onSelect={(id) => {
              const a = alertById(id);
              if (a) selectAlert(a.id);
            }}
          />
        )}
        {radar.showWarnings && radar.showTracks && <StormPathLayer alerts={national.data?.alerts ?? []} selectedId={selectedAlert} now={now} timeZone={timeZone} />}
        {layers.showSites && <SitesLayer selected={site?.icao ?? null} onSelect={(icao) => setRadar({ source: "site", site: icao })} />}
        {layers.showCells && <StormCellsLayer cells={cellList} selectedId={selectedId("cell")} onSelect={(id) => select("cell", id)} />}
        {radar.showStormReports && <StormReportsLayer reports={lsrList} now={now} hours={LSR_HOURS} selectedId={selectedId("lsr")} onSelect={(id) => select("lsr", id)} />}
        {COMMUNITY_ENABLED && layers.showReports && <ReportsLayer posts={(reports.data ?? []) as PostDto[]} now={now} onSelect={(id) => select("post", id)} />}
        {layers.showCams && <WebcamsLayer cams={camList} selectedId={selectedId("cam")} onSelect={(id) => select("cam", id)} />}
        {COMMUNITY_ENABLED && layers.showChasers && (
          <ChasersLayer chasers={chaserList} isLive={(c) => !!liveOf(c)} fetchedAt={chasers.dataUpdatedAt} now={now} onSelect={(u) => select("chaser", u)} />
        )}
        <UserMarker lat={loc.lat} lon={loc.lon} />
        <DrawingLayer id="mine" shapes={drawShapes} />
        <LiveDrawingLayer />
      </MapView>

      {studio && (
        <BroadcastStage
          map={map}
          loop={loop}
          speed={radar.speed}
          alerts={allAlerts}
          activeAlert={activeAlert}
          title={loopTitle}
          placeName={placeName}
          timeZone={timeZone}
          onExit={studio.onExit}
          extra={drawButton}
          layers={layerControls}
        />
      )}
      {drawOpen && <DrawCanvas map={map} />}
      {drawOpen && <DrawToolbar presenter={presenter} airStatus={airStatus} side={broadcasting ? "left" : "right"} />}

      {/* Warnings + layers: side panel on desktop, bottom sheet on phones. Hidden on air. */}
      {!broadcasting && (!desktop || panelOpen) && (
        <Sheet
          detent={detent}
          onDetentChange={setDetent}
          ariaLabel={t("Warnings and radar layers")}
          peekHeight={PEEK}
          desktopClassName="absolute top-3 left-[var(--sl)] z-20 max-h-[calc(100%-24px)] w-[var(--panel-w)]"
          header={!desktop && detent === "peek" ? peekHeader : inlineSelection ? selectionHeader : tabsHeader}
          accessory={desktop ? undefined : dock}
          onLayout={setSheetHeights}
        >
          {sheetBody}
        </Sheet>
      )}
      {!broadcasting && desktop && !panelOpen && (
        <Button data-chrome size="sm" className="absolute top-3 left-[var(--sl)] z-20" onClick={() => setPanelOpen(true)}>
          <Layers className="size-4" aria-hidden />
          {t("Warnings & layers")}
          {ranked.length > 0 && <span className="text-ink-3 tabular">{ranked.length}</span>}
        </Button>
      )}

      {/* Desktop selection details, clear of the dock (elsewhere they show in the panel or sheet). */}
      {!broadcasting && floatDetail && (
        <div className="pointer-events-none absolute top-3 right-[var(--sr)] z-30 w-[380px]" style={{ bottom: 16 + dockH + GAP }}>
          <AnimatePresence mode="wait">
            {activeAlert && (
              <motion.div key={activeAlert.id} {...appear} className="overlay pointer-events-auto max-h-full overflow-y-auto overscroll-contain p-4">
                <AlertDetail alert={activeAlert} now={now} timeZone={timeZone} onClose={clearSelection} reports={reportsFor(activeAlert)} />
              </motion.div>
            )}
            {activeReport && (
              <motion.div key={activeReport.id} {...appear} className="overlay pointer-events-auto flex max-h-full flex-col overflow-hidden">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line py-1.5 pr-1.5 pl-4">
                  <h3 className="text-sm font-semibold text-ink">{t("Spotter report")}</h3>
                  <IconButton label={t("Close report")} size="sm" onClick={clearSelection}>
                    <X className="size-4" aria-hidden />
                  </IconButton>
                </div>
                <div className={cn("min-h-0 overflow-y-auto overscroll-contain", EMBED_POST)}>
                  <PostCard post={activeReport} now={now} />
                </div>
              </motion.div>
            )}
            {(activeLsr || activeCell || activeStorm || activeChaser || activeCam) && (
              <motion.div key={sel?.id} {...appear} className="overlay pointer-events-auto max-h-full overflow-y-auto overscroll-contain p-4">
                {activeLsr && <StormReportDetail report={activeLsr} now={now} timeZone={timeZone} onClose={clearSelection} />}
                {activeCell && <StormCellDetail cell={activeCell} now={now} timeZone={timeZone} location={loc} onClose={clearSelection} />}
                {activeStorm && <TropicalDetail storm={activeStorm} timeZone={timeZone} onClose={clearSelection} />}
                {activeChaser && <ChaserDetail chaser={activeChaser} live={liveOf(activeChaser)} fetchedAt={chasers.dataUpdatedAt} now={now} onClose={clearSelection} />}
                {activeCam && <WebcamDetail cam={activeCam} location={loc} now={now} onClose={clearSelection} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Desktop dock, between the side panel and the zoom buttons (touch devices have none, only the attribution button). */}
      {!broadcasting && desktop && (
        <div
          className={cn(
            "pointer-events-none absolute bottom-4 z-20 right-[calc(var(--sr)+52px)] pointer-coarse:right-[calc(var(--sr)+36px)]",
            panelOpen ? "left-[calc(var(--sl)+var(--panel-w)+12px)]" : "left-[var(--sl)]",
          )}
        >
          <div className="mx-auto max-w-3xl">{dock}</div>
        </div>
      )}
    </div>
  );
}
