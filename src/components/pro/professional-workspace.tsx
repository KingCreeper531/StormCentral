"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForecast, useStormCells } from "@/hooks/queries";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useMapAlerts } from "@/hooks/use-map-alerts";
import { useNow } from "@/hooks/use-now";
import { useT } from "@/lib/i18n/use-t";
import type { LatLon } from "@/lib/geo";
import { isSatellite } from "@/lib/pro/products";
import { stormMotion } from "@/lib/pro/storm-tools";
import { createProSync, syncTime } from "@/lib/pro/sync";
import type { RadarFrame } from "@/lib/radar/frames";
import type { BufferStatus } from "@/lib/radar/layer-manager";
import { frameDelayMs, nextPlayableIndex, stepIndex } from "@/lib/radar/playback";
import { getSite, nearestSites } from "@/lib/radar/site-utils";
import { cn } from "@/lib/utils";
import { useAlertsStore } from "@/store/alerts-store";
import { useAppStore } from "@/store/app-store";
import { PANE_COUNT, useProStore, type Layout } from "@/store/pro-store";
import { AlertDetail } from "../radar/alert-detail";
import { AlertKindsPicker } from "../radar/alert-kinds";
import { IconButton } from "../ui/button";
import { PanelBoundary } from "../ui/panel-boundary";
import { CrossSectionPanel } from "./cross-section-panel";
import { IbwInspector } from "./ibw-inspector";
import { Pane } from "./pane";
import type { ToolShapes } from "./pane-layers";
import { ProProvider, type PaneProbe, type ProContext, type ToolActions } from "./pro-context";
import { ReadoutHud } from "./readout-hud";
import { SoundingPanel } from "./sounding-panel";
import { StormToolsPanel } from "./storm-tools-panel";
import { WarnGenPanel } from "./warngen-panel";
import { ProToolbar, TOOLS } from "./toolbar";
import { useProCaps } from "./use-pro-caps";

const GRID: Record<Layout, { cols: number; rows: number }> = { "1x1": { cols: 1, rows: 1 }, "1x2": { cols: 2, rows: 1 }, "2x2": { cols: 2, rows: 2 }, "3x3": { cols: 3, rows: 3 } };

/**
 * Professional mode: an AWIPS II / CAVE-style workspace. Up to nine map
 * panels share one camera, one loop clock and one cursor through a vanilla
 * zustand store (lib/pro/sync.ts) that panes subscribe to imperatively, so
 * panning or looping a 3×3 grid costs no React renders. Around the grid: the
 * toolbar (layout, site, tools, loop), per-panel headers (product, tilt,
 * opacity, overlays), the cursor readout, and a side panel for the analysis
 * tools (sounding, cross-section, storm vector / time of arrival, warning
 * inspector).
 */
export function ProfessionalWorkspace() {
  const t = useT();
  const home = useAppStore((s) => s.location);
  const caps = useProCaps();
  const narrow = caps.narrow;
  const [sync] = useState(() => createProSync({ lng: home.lon, lat: home.lat, zoom: 6.4, source: "workspace" }));
  const [probes] = useState(() => new Map<string, PaneProbe>());

  const storedLayout = useProStore((s) => s.layout);
  const allPanes = useProStore((s) => s.panes);
  const frames = useProStore((s) => s.frames);
  const speed = useProStore((s) => s.speed);
  const tool = useProStore((s) => s.tool);
  const pinned = useProStore((s) => s.site);
  const vector = useProStore((s) => s.vector);
  const setVector = useProStore((s) => s.setVector);
  const toaPoints = useProStore((s) => s.toaPoints);
  const addToaPoint = useProStore((s) => s.addToaPoint);
  const clearToaPoints = useProStore((s) => s.clearToaPoints);
  const places = useAlertsStore((s) => s.places);
  const radar = useAppStore((s) => s.radar);
  const setRadar = useAppStore((s) => s.setRadar);

  // Phones get one or two stacked panels.
  const layout: Layout = narrow && (storedLayout === "2x2" || storedLayout === "3x3") ? "1x2" : storedLayout;
  const grid = narrow && layout === "1x2" ? { cols: 1, rows: 2 } : GRID[layout];
  const panes = useMemo(() => allPanes.slice(0, PANE_COUNT[layout]), [allPanes, layout]);
  // Big grids and phones loop fewer frames (each frame is a full set of textures per panel).
  const frameCount = Math.min(caps.maxFrames, layout === "3x3" ? Math.min(frames, 8) : frames);
  // The time basis: the first radar panel (satellite panels follow it).
  const basisId = (panes.find((p) => !isSatellite(p.product)) ?? panes[0])!.id;

  const site = getSite(pinned) ?? nearestSites(home, 1)[0]!;

  // ── Shared overlays ───────────────────────────────────────────────────────
  // Storm-based warnings plus the hazard-map products picked in the radar settings.
  const { all: mapAlerts } = useMapAlerts();
  const alerts = useMemo(() => mapAlerts.filter((a) => a.geometry), [mapAlerts]);
  const now = useNow();
  const cellsQ = useStormCells(panes.some((p) => p.cells));
  const cells = useMemo(() => cellsQ.data?.cells ?? [], [cellsQ.data]);
  const timeZone = useForecast().data?.timezone;

  // ── Loop clock ────────────────────────────────────────────────────────────
  const onBasisFeed = useCallback(
    (list: RadarFrame[]) => {
      const times = list.map((f) => f.time);
      const s = sync.getState();
      const prevT = s.timeline.length ? syncTime(s) : null;
      const keep = prevT == null ? -1 : times.indexOf(prevT);
      // `ready` is left alone: the basis panel's buffer status for these frames arrives separately (and may already have).
      sync.setState({ timeline: times, index: keep >= 0 ? keep : Math.max(0, times.length - 1) });
    },
    [sync],
  );
  const onBasisStatus = useCallback((st: BufferStatus) => sync.setState({ ready: st.ready }), [sync]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = sync.getState();
      let delay = 400;
      if (s.playing && s.timeline.length > 1) {
        // Only step onto frames the time-basis panel has buffered.
        const next = nextPlayableIndex(s.index, s.ready.length === s.timeline.length ? s.ready : []);
        if (next !== s.index) sync.setState({ index: next });
        delay = frameDelayMs(next, s.timeline.length, speed);
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
  }, [sync, speed]);

  const step = useCallback(
    (d: number) => {
      const s = sync.getState();
      sync.setState({ playing: false, index: stepIndex(s.index, d, s.timeline.length) });
    },
    [sync],
  );
  const toggle = useCallback(() => sync.setState((s) => ({ playing: !s.playing })), [sync]);

  // ── Tools ─────────────────────────────────────────────────────────────────
  const [soundingAt, setSoundingAt] = useState<LatLon>({ lat: home.lat, lon: home.lon });
  const [xsect, setXsect] = useState<{ a: LatLon; b: LatLon | null } | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  // Phones start with the maps uncovered; the panel opens when a tool needs it.
  const [panelOpen, setPanelOpen] = useState(!narrow);
  const toolRef = useRef(tool);
  useEffect(() => {
    toolRef.current = tool;
  });
  // Picking an analysis tool brings its panel up.
  useEffect(
    () =>
      useProStore.subscribe((s, prev) => {
        if (s.tool !== prev.tool && s.tool !== "inspect") setPanelOpen(true);
      }),
    [],
  );

  const tools = useMemo<ToolActions>(
    () => ({
      sounding: (p) => {
        setSoundingAt(p);
        setPanelOpen(true);
      },
      xsect: (p) => {
        setXsect((prev) => (!prev || prev.b ? { a: p, b: null } : { a: prev.a, b: p }));
        setPanelOpen(true);
      },
      vector: (p) => {
        const at = { ...p, t: syncTime(sync.getState()) };
        const v = useProStore.getState().vector;
        setVector(!v || v.b ? { a: at, b: null } : { a: v.a, b: at });
        setPanelOpen(true);
      },
      toa: (p) => addToaPoint({ ...p, name: `${t("Point")} ${useProStore.getState().toaPoints.length + 1}` }),
      // Drag-me-to-storm: the first click places the storm, a second (on another frame) tracks it; then clicks are left alone.
      warngen: (p) => {
        const v = useProStore.getState().vector;
        const at = { ...p, t: syncTime(sync.getState()) };
        if (!v) setVector({ a: at, b: null });
        else if (!v.b) setVector({ a: v.a, b: at });
        setPanelOpen(true);
      },
      selectAlert: (id) => {
        if (toolRef.current !== "inspect") return;
        setSelectedAlert(id);
        setPanelOpen(true);
      },
    }),
    [sync, setVector, addToaPoint, t],
  );
  const ctx = useMemo<ProContext>(() => ({ sync, probes, tools }), [sync, probes, tools]);

  const motion = useMemo(() => (vector?.b ? stormMotion(vector.a, vector.b) : null), [vector]);
  const shapes = useMemo<ToolShapes>(
    () => ({
      sounding: tool === "sounding" ? soundingAt : null,
      xsect: tool === "xsect" ? xsect : null,
      vector: vector ? { a: vector.a, b: vector.b } : null,
      motion,
      toaPoints,
      showFan: !!motion,
    }),
    [tool, soundingAt, xsect, vector, motion, toaPoints],
  );
  const arrivalPoints = useMemo(() => [{ lat: home.lat, lon: home.lon, name: home.name }, ...places.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name })), ...toaPoints], [home, places, toaPoints]);
  const activeAlert = selectedAlert ? alerts.find((a) => a.id === selectedAlert) : undefined;

  useHotkeys({
    " ": (e) => {
      e.preventDefault();
      toggle();
    },
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    Escape: () => setSelectedAlert(null),
  });

  const toolDef = TOOLS.find((x) => x.id === tool)!;
  const panel = (() => {
    if (tool === "sounding") return <SoundingPanel point={soundingAt} motion={motion} />;
    if (tool === "xsect") return xsect?.b ? <CrossSectionPanel a={xsect.a} b={xsect.b} /> : <p className="p-3 text-[12px] text-ink-3">{t(xsect ? "Now click the end point (A′)." : "Click the start point (A) on any panel.")}</p>;
    if (tool === "warngen") return <WarnGenPanel timeZone={timeZone} />;
    if (tool === "vector" || tool === "toa")
      return (
        <StormToolsPanel
          motion={motion}
          picking={!vector ? 0 : vector.b ? 2 : 1}
          points={arrivalPoints}
          timeZone={timeZone}
          onReset={() => setVector(null)}
          onClearPoints={clearToaPoints}
        />
      );
    if (activeAlert)
      // Storm-based NWS warnings carry IBW tags; everything else (watches, advisories, discussions, other countries) gets the plain text.
      return !activeAlert.area && !activeAlert.lean && (activeAlert.source ?? "nws") === "nws" ? (
        <IbwInspector alert={activeAlert} onClose={() => setSelectedAlert(null)} />
      ) : (
        <AlertDetail alert={activeAlert} now={now} timeZone={timeZone} onClose={() => setSelectedAlert(null)} className="p-3" />
      );
    return (
      <div className="space-y-3 p-3">
        <p className="text-[12px] text-ink-3">{t("Click a warning polygon to inspect its impact-based tags. Pick a tool above for soundings, cross-sections and storm tracking.")}</p>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-ink-2">{t("Storm-based warnings always show. Also draw:")}</p>
          <AlertKindsPicker settings={radar} onChange={setRadar} compact />
        </div>
      </div>
    );
  })();
  const vectorSameTime = vector?.b && !motion;

  return (
    <ProProvider value={ctx}>
      <div className="absolute inset-0 flex flex-col bg-canvas">
        <ProToolbar site={site} onStep={step} onToggle={toggle} narrow={narrow} />
        <div className="relative flex min-h-0 flex-1">
          <div
            className="grid min-h-0 min-w-0 flex-1 gap-px bg-line"
            style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}
          >
            {panes.map((p, i) => (
              <PanelBoundary key={p.id} name={`pro-pane-${p.id}`}>
                <Pane
                  config={p}
                  n={i + 1}
                  site={site.icao}
                  frameCount={frameCount}
                  caps={caps}
                  basis={p.id === basisId}
                  tool={tool}
                  alerts={alerts}
                  selectedAlert={selectedAlert}
                  cells={cells}
                  shapes={shapes}
                  home={home}
                  compact={layout === "3x3"}
                  onBasisFeed={onBasisFeed}
                  onBasisStatus={onBasisStatus}
                />
              </PanelBoundary>
            ))}
          </div>
          {panelOpen ? (
            <aside
              className={cn(
                "flex min-h-0 flex-col border-line bg-surface-1",
                narrow ? "absolute inset-x-0 bottom-0 z-20 max-h-[60%] border-t shadow-2xl" : "w-[340px] shrink-0 border-l xl:w-[380px]",
              )}
            >
              <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                <toolDef.Icon className="size-4 text-ink-3" aria-hidden />
                <h2 className="flex-1 text-[13px] font-semibold text-ink">{t(activeAlert && tool === "inspect" ? "Warning inspector" : toolDef.label)}</h2>
                <IconButton size="sm" label={t("Hide panel")} onClick={() => setPanelOpen(false)}>
                  <PanelRightClose className="size-4" aria-hidden />
                </IconButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {vectorSameTime && <p className="m-3 mb-0 rounded-[4px] bg-caution/15 p-2 text-[12px] text-ink">{t("Both clicks were on the same frame. Step the loop, then click the storm again.")}</p>}
                <PanelBoundary name="pro-tool-panel" resetKey={tool}>
                  {panel}
                </PanelBoundary>
              </div>
            </aside>
          ) : (
            <div className="absolute top-1/2 right-1.5 z-20 -translate-y-1/2">
              <IconButton size="sm" variant="secondary" label={t("Show panel")} onClick={() => setPanelOpen(true)}>
                <PanelRightOpen className="size-4" aria-hidden />
              </IconButton>
            </div>
          )}
        </div>
        <ReadoutHud site={site} />
      </div>
    </ProProvider>
  );
}
