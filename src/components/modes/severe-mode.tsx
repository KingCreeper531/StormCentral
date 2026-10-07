"use client";

import type { Map as MlMap } from "maplibre-gl";
import { ChevronLeft, CircleAlert, Layers, PanelLeftClose, Pause, Play, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import { CATEGORIES, type PostDto } from "@/lib/community";
import { distanceToGeometryKm, geometryContains, type BBox } from "@/lib/geo";
import { FAMILIES, resolveTilts } from "@/lib/radar/products";
import { iemSiteId } from "@/lib/radar/frames";
import { getSite, nearestSites } from "@/lib/radar/site-utils";
import { useLocalAlerts, useNationalAlerts, useOutlook, useRadarProducts, useReportsInView } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsDesktop, useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useRadarLoop } from "@/hooks/use-radar-loop";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { PostCard } from "../community/post-card";
import { MapView } from "../map/map-view";
import { OutlookLayer } from "../map/layers/outlook-layer";
import { RadarLayer } from "../map/layers/radar-layer";
import { ReportsLayer } from "../map/layers/reports-layer";
import { SitesLayer } from "../map/layers/sites-layer";
import { TracksLayer } from "../map/layers/tracks-layer";
import { UserMarker } from "../map/layers/user-marker";
import { WarningsLayer } from "../map/layers/warnings-layer";
import { AlertDetail } from "../radar/alert-detail";
import { AlertList, alertUntil, HazardSwatch, type RankedAlert } from "../radar/alert-list";
import { RadarControls } from "../radar/radar-controls";
import { RadarLegend } from "../radar/radar-legend";
import { frameTimeLabel, RadarTimeline } from "../radar/radar-timeline";
import { Button, IconButton } from "../ui/button";
import { ErrorNote } from "../ui/misc";
import { Sheet, type Detent } from "../ui/sheet";
import { Tabs } from "../ui/tabs";

type PanelTab = "alerts" | "radar";
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
export function SevereMode() {
  const loc = useAppStore((s) => s.location);
  const radar = useAppStore((s) => s.radar);
  const setRadar = useAppStore((s) => s.setRadar);
  const now = useNow(30_000);
  const fmt = useFormat();
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
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [bbox, setBbox] = useState<BBox | null>(null);
  /** A request to frame bounds; `n` makes repeat requests for the same bounds distinct. */
  const [fitRequest, setFitRequest] = useState<{ bounds: Bounds; n: number } | null>(null);
  const fitDone = useRef(0);
  const [dockRef, dockH] = useHeight<HTMLDivElement>();
  const panelW = short ? 280 : wide ? 340 : 300;

  // ── Radar product resolution (driven by what IEM actually has) ────────────
  const isSite = radar.source === "site";
  const site = isSite ? (getSite(radar.site) ?? nearestSites(loc, 1)[0]!) : null;
  const products = useRadarProducts(site ? iemSiteId(site.icao) : null);
  const available = useMemo(() => (products.data?.products.length ? new Set(products.data.products) : null), [products.data]);
  const tilts = isSite ? resolveTilts(radar.family, available) : [];
  const tilt = tilts.find((t) => t.prefix === radar.tilt) ?? tilts[0];
  const productCode = isSite ? (tilt?.code ?? `N0${FAMILIES[radar.family].letters[0]}`) : "N0Q";

  const loop = useRadarLoop({ site: site?.icao ?? null, product: productCode, frameCount: radar.frames, speed: radar.speed, crossfade: radar.crossfade });

  // ── Overlays ──────────────────────────────────────────────────────────────
  const national = useNationalAlerts(true);
  const local = useLocalAlerts();
  const outlook = useOutlook(radar.showOutlook);
  const reports = useReportsInView(bbox, radar.showReports);

  const ranked = useMemo<RankedAlert[]>(() => {
    const out = new Map<string, RankedAlert>();
    for (const a of national.data?.alerts ?? []) {
      if (!a.geometry) continue;
      const inside = geometryContains(a.geometry, loc);
      const d = inside ? 0 : distanceToGeometryKm(a.geometry, loc);
      if (d <= 500) out.set(a.id, { alert: a, distanceKm: d, inside });
    }
    for (const a of local.data?.alerts ?? []) if (!out.has(a.id)) out.set(a.id, { alert: a, distanceKm: 0, inside: true });
    return [...out.values()].sort((x, y) => Number(y.inside) - Number(x.inside) || y.alert.rank - x.alert.rank || x.distanceKm - y.distanceKm);
  }, [national.data, local.data, loc]);

  const allAlerts = useMemo(() => [...(national.data?.alerts ?? []), ...(local.data?.alerts ?? [])], [national.data, local.data]);
  const alertById = (id: string | null) => (id ? allAlerts.find((a) => a.id === id) : undefined);
  const activeAlert = alertById(selectedAlert);
  const activeReport = (reports.data ?? []).find((p) => p.id === selectedReport);

  // ── Selection ─────────────────────────────────────────────────────────────
  /** Without the floating column, details show in the panel/sheet: switch to warnings and reveal it. */
  const revealSelection = () => {
    if (floatDetail) return;
    setTab("alerts");
    if (desktop) setPanelOpen(true);
    else setDetent((d) => (d === "full" ? "full" : "half"));
  };
  const openSheet = (t: PanelTab) => {
    setTab(t);
    setDetent((d) => (d === "peek" ? "half" : d));
  };
  const selectAlert = (id: string) => {
    setSelectedAlert(id);
    setSelectedReport(null);
    revealSelection();
  };
  const selectReport = (id: string) => {
    setSelectedReport(id);
    setSelectedAlert(null);
    revealSelection();
  };
  const clearSelection = () => {
    setSelectedAlert(null);
    setSelectedReport(null);
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

  const family = isSite ? radar.family : "reflectivity";

  // ── Legend caption: where the data comes from ─────────────────────────────
  const caption =
    isSite && site ? (
      <>
        <span className="shrink-0 font-mono">
          {site.icao} {productCode}
        </span>
        <span className="min-w-0 truncate">
          {site.place}, {site.state}
        </span>
      </>
    ) : (
      <>
        <span className="shrink-0 font-mono">N0Q</span>
        <span className="min-w-0 truncate">{loop.usingFallback ? "Mosaic (rolling)" : "National mosaic"}</span>
      </>
    );

  // ── Sheet header ──────────────────────────────────────────────────────────
  const where = (r: RankedAlert) => `${r.inside ? "Over your location" : `${fmt.distanceKm(r.distanceKm)} away`}, until ${alertUntil(r.alert)}`;
  const top = ranked[0];
  const hasSelection = !!(activeAlert || activeReport);
  /** The selection replaces the warnings list (and the tabs) in the panel/sheet. */
  const inlineSelection = !floatDetail && hasSelection && tab === "alerts";

  // ── Camera: keep MapLibre's padding in sync with the overlays ─────────────
  // Centring (initial view, location changes) and framing then use the part
  // of the map the panel, sheet, details and transport leave visible.
  const padding = useMemo<Padding>(() => {
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
  }, [desktop, panelOpen, panelW, floatDetail, hasSelection, dockH, sheetHeights, detent]);

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

  // Phone peek: one useful line — the selection, else the highest-ranked warning nearby.
  let peek: { color: string | null; title: string; sub: string };
  if (activeAlert) {
    const r = ranked.find((x) => x.alert.id === activeAlert.id);
    peek = { color: activeAlert.color, title: activeAlert.event, sub: r ? where(r) : `Until ${alertUntil(activeAlert)}` };
  } else if (activeReport) {
    const cat = CATEGORIES[activeReport.category] ?? CATEGORIES.observation;
    peek = { color: null, title: "Spotter report", sub: activeReport.place ? `${cat.label}, ${activeReport.place}` : cat.label };
  } else if (top) {
    peek = { color: top.alert.color, title: top.alert.event, sub: where(top) };
  } else if (national.isLoading) {
    peek = { color: null, title: "Loading warnings", sub: "NWS active alerts" };
  } else if (national.error) {
    peek = { color: null, title: "Warnings unavailable", sub: "NWS alerts could not be loaded" };
  } else {
    peek = { color: null, title: "No warnings nearby", sub: `Within 500 km of ${loc.name}` };
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
        {!hasSelection && ranked.length > 1 && <span className="shrink-0 text-xs text-ink-3 tabular">{ranked.length} warnings</span>}
      </button>
      <IconButton label="Radar & layers" onClick={() => openSheet("radar")}>
        <Layers className="size-5" aria-hidden />
      </IconButton>
    </div>
  );

  // Phones at the full detent: the transport on top of the sheet is off-screen,
  // so the header keeps play/pause and the frame time.
  const frameTime = frameTimeLabel(loop);
  const headerTransport = !desktop && detent === "full" && (
    <div className="flex shrink-0 items-center gap-1">
      {frameTime && <span className="font-mono text-xs text-ink-3">{frameTime}</span>}
      <IconButton label={loop.playing ? "Pause radar loop" : "Play radar loop"} onClick={loop.toggle} disabled={loop.frames.length < 2}>
        {loop.playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
      </IconButton>
    </div>
  );
  const hidePanel = desktop && (
    <IconButton label="Hide panel" size="sm" onClick={() => setPanelOpen(false)}>
      <PanelLeftClose className="size-4" aria-hidden />
    </IconButton>
  );

  const tabsHeader = (
    <div className="flex items-center justify-between gap-2 pr-1.5 pl-4">
      <Tabs<PanelTab>
        ariaLabel="Warnings and layers"
        value={tab}
        onChange={setTab}
        items={[
          { value: "alerts", label: "Warnings", count: ranked.length },
          { value: "radar", label: "Radar & layers" },
        ]}
      />
      {hidePanel || headerTransport}
    </div>
  );

  // A single warning or report: back to the list, swatch and title. Replaces the tabs.
  const selectionHeader = (
    <div className="flex min-h-10 items-center gap-2 py-0.5 pr-1.5 pl-1">
      <IconButton label="Back to warnings" onClick={clearSelection}>
        <ChevronLeft className="size-5" aria-hidden />
      </IconButton>
      {activeAlert && <HazardSwatch color={activeAlert.color} />}
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{activeAlert ? activeAlert.event : "Spotter report"}</h2>
      {hidePanel || headerTransport}
    </div>
  );

  // ── Sheet body ────────────────────────────────────────────────────────────
  const listPending = !ranked.length && (national.isLoading || !!national.error);
  const warningsBody = (
    <>
      {national.isLoading && <p className="label px-4 pt-3 pb-1">Loading NWS warnings</p>}
      {national.error ? (
        <div className="px-4 pt-3 pb-1">
          <ErrorNote error={national.error} what="NWS warnings" />
        </div>
      ) : null}
      {!listPending && <AlertList items={ranked} selectedId={selectedAlert} onSelect={focusAlert} />}
      {ranked.length > 0 && <p className="label border-t border-line px-4 py-3">Within 500 km of {loc.name}</p>}
    </>
  );

  // Without the floating column, a selection replaces the list (its header shows the title).
  const selectionBody = activeAlert ? (
    <AlertDetail alert={activeAlert} now={now} hideTitle className="p-4" />
  ) : activeReport ? (
    <div className={EMBED_POST}>
      <PostCard post={activeReport} now={now} />
    </div>
  ) : null;

  const sheetBody =
    tab === "radar" ? (
      <div className="p-4">
        <RadarControls settings={radar} onChange={setRadar} site={site} available={available} location={loc} />
      </div>
    ) : inlineSelection ? (
      selectionBody
    ) : (
      warningsBody
    );

  // ── Dock: legend + transport ──────────────────────────────────────────────
  // Desktop: legend card above the transport. Short screens: one row with an
  // inline legend. Phones: a legend strip inside the transport box, all of it
  // riding on top of the sheet.
  const legendCode = isSite && site ? `${site.icao} ${productCode}` : "N0Q";
  const dock = (
    <div ref={dockRef} className="pointer-events-none flex flex-col items-start gap-2 [&>*]:pointer-events-auto">
      {desktop && !short && <RadarLegend family={family} caption={caption} />}
      {loop.error ? (
        <p role="status" className="overlay flex items-start gap-2 px-3 py-2 text-xs text-ink-2">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-nogo" aria-hidden />
          <span>
            Radar index unavailable for <span className="font-mono">{site?.icao ?? "mosaic"} {productCode}</span>. Try another product or site.
          </span>
        </p>
      ) : null}
      <div className="w-full">
        <RadarTimeline
          loop={loop}
          speed={radar.speed}
          onSpeed={(speed) => setRadar({ speed })}
          now={now}
          compact={short}
          showSpeed
          legend={!desktop ? <RadarLegend variant="strip" family={family} code={legendCode} /> : short ? <RadarLegend variant="inline" family={family} code={legendCode} /> : undefined}
          legendPosition={desktop ? "end" : "top"}
        />
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "absolute inset-0 bg-black",
        // Overlay insets that respect a landscape notch, and the side-panel width (keep in sync with `panelW`).
        "[--sl:max(12px,env(safe-area-inset-left))] [--sr:max(12px,env(safe-area-inset-right))]",
        short ? "[--panel-w:280px]" : "[--panel-w:300px] lg:[--panel-w:340px]",
        // MapLibre zoom/attribution: clear of the notch; on phones move them to the top right,
        // since the bottom of the map belongs to the sheet and the transport.
        "[&_.maplibregl-ctrl-bottom-right]:pr-[env(safe-area-inset-right)]",
        "max-md:[&_.maplibregl-ctrl-bottom-right]:top-3 max-md:[&_.maplibregl-ctrl-bottom-right]:bottom-auto",
      )}
    >
      <MapView center={loc} zoom={isSite ? 7.5 : 6} onViewChange={(b) => setBbox(b)} onReady={setMap}>
        {radar.showOutlook && <OutlookLayer features={outlook.data?.features ?? []} />}
        <RadarLayer frames={loop.frames} index={loop.index} opacity={radar.opacity} crisp={FAMILIES[family].crisp && isSite} crossfadeMs={loop.crossfadeMs} onStatus={loop.onStatus} />
        {radar.showWarnings && (
          <WarningsLayer
            alerts={national.data?.alerts ?? []}
            selectedId={selectedAlert}
            onSelect={(id) => {
              const a = alertById(id);
              if (a) selectAlert(a.id);
            }}
          />
        )}
        {radar.showWarnings && radar.showTracks && <TracksLayer alerts={national.data?.alerts ?? []} now={now} />}
        {radar.showSites && <SitesLayer selected={site?.icao ?? null} onSelect={(icao) => setRadar({ source: "site", site: icao })} />}
        {radar.showReports && <ReportsLayer posts={(reports.data ?? []) as PostDto[]} now={now} onSelect={selectReport} />}
        <UserMarker lat={loc.lat} lon={loc.lon} />
      </MapView>

      {/* Warnings + layers: side panel on desktop, bottom sheet on phones. */}
      {(!desktop || panelOpen) && (
        <Sheet
          detent={detent}
          onDetentChange={setDetent}
          ariaLabel="Warnings and radar layers"
          peekHeight={PEEK}
          desktopClassName="absolute top-3 left-[var(--sl)] z-20 max-h-[calc(100%-24px)] w-[var(--panel-w)]"
          header={!desktop && detent === "peek" ? peekHeader : inlineSelection ? selectionHeader : tabsHeader}
          accessory={desktop ? undefined : dock}
          onLayout={setSheetHeights}
        >
          {sheetBody}
        </Sheet>
      )}
      {desktop && !panelOpen && (
        <Button size="sm" className="absolute top-3 left-[var(--sl)] z-20" onClick={() => setPanelOpen(true)}>
          <Layers className="size-4" aria-hidden />
          Warnings & layers
          {ranked.length > 0 && <span className="text-ink-3 tabular">{ranked.length}</span>}
        </Button>
      )}

      {/* Desktop selection details, clear of the dock (elsewhere they show in the panel or sheet). */}
      {floatDetail && (
        <div className="pointer-events-none absolute top-3 right-[var(--sr)] z-30 w-[380px]" style={{ bottom: 16 + dockH + GAP }}>
          <AnimatePresence mode="wait">
            {activeAlert && (
              <motion.div key={activeAlert.id} {...appear} className="overlay pointer-events-auto max-h-full overflow-y-auto overscroll-contain p-4">
                <AlertDetail alert={activeAlert} now={now} onClose={() => setSelectedAlert(null)} />
              </motion.div>
            )}
            {activeReport && (
              <motion.div key={activeReport.id} {...appear} className="overlay pointer-events-auto flex max-h-full flex-col overflow-hidden">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line py-1.5 pr-1.5 pl-4">
                  <h3 className="text-sm font-semibold text-ink">Spotter report</h3>
                  <IconButton label="Close report" size="sm" onClick={() => setSelectedReport(null)}>
                    <X className="size-4" aria-hidden />
                  </IconButton>
                </div>
                <div className={cn("min-h-0 overflow-y-auto overscroll-contain", EMBED_POST)}>
                  <PostCard post={activeReport} now={now} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Desktop dock, between the side panel and the zoom buttons (touch devices have none, only the attribution button). */}
      {desktop && (
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
