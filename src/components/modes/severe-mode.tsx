"use client";

import type { Map as MlMap } from "maplibre-gl";
import { Layers, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import type { PostDto } from "@/lib/community";
import { distanceToGeometryKm, geometryContains, type BBox } from "@/lib/geo";
import { FAMILIES, resolveTilts } from "@/lib/radar/products";
import { iemSiteId } from "@/lib/radar/frames";
import { getSite, nearestSites } from "@/lib/radar/site-utils";
import { useLocalAlerts, useNationalAlerts, useOutlook, useRadarProducts, useReportsInView } from "@/hooks/queries";
import { useHotkeys } from "@/hooks/use-hotkeys";
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
import { AlertList, type RankedAlert } from "../radar/alert-list";
import { RadarControls } from "../radar/radar-controls";
import { RadarLegend } from "../radar/radar-legend";
import { RadarTimeline } from "../radar/radar-timeline";

export function SevereMode() {
  const loc = useAppStore((s) => s.location);
  const radar = useAppStore((s) => s.radar);
  const setRadar = useAppStore((s) => s.setRadar);
  const now = useNow(30_000);
  const mapRef = useRef<MlMap | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<"alerts" | "radar">("alerts");
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [bbox, setBbox] = useState<BBox | null>(null);

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

  const focusAlert = useCallback((a: WeatherAlert) => {
    setSelectedAlert(a.id);
    setSelectedReport(null);
    const map = mapRef.current;
    if (!map || !a.geometry) return;
    const coords = (a.geometry.type === "Polygon" ? a.geometry.coordinates.flat() : a.geometry.coordinates.flat(2)) as [number, number][];
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 120, maxZoom: 9, duration: 900 });
  }, []);

  useHotkeys({
    " ": (e) => {
      e.preventDefault();
      loop.toggle();
    },
    ArrowLeft: () => loop.step(-1),
    ArrowRight: () => loop.step(1),
    Escape: () => {
      setSelectedAlert(null);
      setSelectedReport(null);
    },
  });

  const family = isSite ? radar.family : "reflectivity";

  return (
    <div className="absolute inset-0 bg-black">
      <MapView center={loc} zoom={isSite ? 7.5 : 6} onViewChange={(b) => setBbox(b)} onReady={(m) => (mapRef.current = m)}>
        {radar.showOutlook && <OutlookLayer features={outlook.data?.features ?? []} />}
        <RadarLayer frames={loop.frames} index={loop.index} opacity={radar.opacity} crisp={FAMILIES[family].crisp && isSite} crossfadeMs={loop.crossfadeMs} onStatus={loop.onStatus} />
        {radar.showWarnings && <WarningsLayer alerts={national.data?.alerts ?? []} selectedId={selectedAlert} onSelect={(id) => {
          const a = alertById(id);
          if (a) {
            setSelectedAlert(a.id);
            setSelectedReport(null);
          }
        }} />}
        {radar.showWarnings && radar.showTracks && <TracksLayer alerts={national.data?.alerts ?? []} now={now} />}
        {radar.showSites && <SitesLayer selected={site?.icao ?? null} onSelect={(icao) => setRadar({ source: "site", site: icao })} />}
        {radar.showReports && <ReportsLayer posts={(reports.data ?? []) as PostDto[]} now={now} onSelect={(id) => {
          setSelectedReport(id);
          setSelectedAlert(null);
        }} />}
        <UserMarker lat={loc.lat} lon={loc.lon} />
      </MapView>

      {/* Control panel */}
      <AnimatePresence initial={false}>
        {panelOpen && (
          <motion.aside
            initial={{ x: -24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="glass-strong absolute top-20 bottom-36 left-3 z-20 flex w-[min(340px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl sm:left-5 md:bottom-28"
          >
            <div className="flex items-center gap-1 border-b border-line p-2">
              {(["alerts", "radar"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn("flex-1 rounded-xl py-1.5 text-xs font-semibold capitalize transition", tab === t ? "bg-white/10 text-ink" : "text-ink-3 hover:text-ink")}
                >
                  {t === "alerts" ? `Warnings${ranked.length ? ` · ${ranked.length}` : ""}` : "Radar & layers"}
                </button>
              ))}
              <button type="button" onClick={() => setPanelOpen(false)} className="grid size-8 place-items-center rounded-xl text-ink-3 hover:bg-white/10" aria-label="Hide panel">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {tab === "alerts" ? (
                <>
                  {national.isLoading && <p className="px-1 pb-2 text-xs text-ink-3">Loading NWS warnings…</p>}
                  {national.error && <p className="px-1 pb-2 text-xs text-nogo">NWS alerts unavailable right now.</p>}
                  <AlertList items={ranked} selectedId={selectedAlert} onSelect={focusAlert} />
                </>
              ) : (
                <RadarControls settings={radar} onChange={setRadar} site={site} available={available} location={loc} />
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      {!panelOpen && (
        <button type="button" onClick={() => setPanelOpen(true)} className="glass-strong absolute top-20 left-3 z-20 flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold sm:left-5">
          <Layers className="size-4" /> Warnings & layers {ranked.length > 0 && <span className="rounded-full bg-nogo px-1.5 text-[10px] text-white">{ranked.length}</span>}
        </button>
      )}

      {/* Selection details */}
      <div className="absolute top-20 right-3 z-20 w-[min(380px,calc(100vw-1.5rem))] sm:right-5">
        <AnimatePresence mode="wait">
          {activeAlert && (
            <motion.div key={activeAlert.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <AlertDetail alert={activeAlert} now={now} onClose={() => setSelectedAlert(null)} />
            </motion.div>
          )}
          {activeReport && (
            <motion.div key={activeReport.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="relative max-h-[60vh] overflow-y-auto rounded-[var(--radius-pane)]">
              <button type="button" onClick={() => setSelectedReport(null)} className="absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-full bg-black/50 hover:bg-white/10" aria-label="Close report">
                <X className="size-4" />
              </button>
              <PostCard post={activeReport} now={now} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Transport + legend */}
      <div className="absolute inset-x-3 bottom-24 z-20 flex flex-col items-center gap-2 sm:inset-x-5 md:bottom-5">
        <div className="flex w-full max-w-3xl items-end justify-between gap-2">
          <RadarLegend family={family} />
          <p className="glass-strong hidden rounded-xl px-2.5 py-1.5 text-[11px] text-ink-2 sm:block">
            {isSite && site ? `${site.icao} · ${site.place}, ${site.state} · ${productCode}` : loop.usingFallback ? "NEXRAD mosaic (rolling)" : "NEXRAD national mosaic · N0Q"}
          </p>
        </div>
        <div className="w-full max-w-3xl">
          <RadarTimeline loop={loop} speed={radar.speed} onSpeed={(speed) => setRadar({ speed })} now={now} />
        </div>
        {loop.error ? <p className="glass-strong rounded-xl px-3 py-1.5 text-xs text-nogo">Radar index unavailable for {site?.icao ?? "mosaic"} · {productCode}. Try another product or site.</p> : null}
      </div>
    </div>
  );
}
