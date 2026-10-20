"use client";

import { BookOpen, ChartSpline, Crosshair, History, Layers, MousePointer2, Pause, Play, Route, Scissors, Siren, SkipBack, SkipForward, Square, Columns2, Grid2x2, Grid3x3, Waves } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "@/lib/i18n/use-t";
import { syncTime, useProSync } from "@/lib/pro/sync";
import { nearestSites, type RadarSite } from "@/lib/radar/site-utils";
import { useAppStore } from "@/store/app-store";
import { LAYOUTS, useProStore, type Layout, type ProTool } from "@/store/pro-store";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { ArchiveStrip } from "../radar/archive-picker";
import { IconButton } from "../ui/button";
import { usePro } from "./pro-context";

const LAYOUT_ICON: Record<Layout, typeof Square> = { "1x1": Square, "1x2": Columns2, "2x2": Grid2x2, "3x3": Grid3x3 };

export const TOOLS: { id: ProTool; label: string; Icon: typeof Square; hint: string }[] = [
  { id: "inspect", label: "Inspect", Icon: MousePointer2, hint: "Sample panels; click a warning to inspect it" },
  { id: "sounding", label: "Sounding", Icon: Waves, hint: "Click for a model Skew-T and hodograph" },
  { id: "meteogram", label: "Meteogram", Icon: ChartSpline, hint: "Click for every model's forecast and ensemble plumes" },
  { id: "xsect", label: "Cross-section", Icon: Scissors, hint: "Click A, then A′" },
  { id: "vector", label: "Storm vector", Icon: Route, hint: "Click a storm at two loop times" },
  { id: "toa", label: "TOA", Icon: Crosshair, hint: "Click to add arrival points" },
  // Issues to the spotter network's database: needs the server (not in the Android app).
  ...(COMMUNITY_ENABLED ? [{ id: "warngen" as const, label: "WarnGen", Icon: Siren, hint: "Draw and issue a spotter-network warning" }] : []),
];

/** The loop clock in Zulu time (with the date, looking back), written straight to the DOM on each step. */
function LoopClock({ dated }: { dated: boolean }) {
  const { sync } = usePro();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = () => {
      if (!ref.current) return;
      const s = sync.getState();
      if (!s.timeline.length) {
        ref.current.textContent = "--:--Z";
        return;
      }
      const d = new Date(syncTime(s));
      const day = dated ? `${d.toISOString().slice(0, 10)} ` : "";
      ref.current.textContent = `${day}${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z  ${s.index + 1}/${s.timeline.length}`;
    };
    write();
    return sync.subscribe((s, prev) => {
      if (s.index !== prev.index || s.timeline !== prev.timeline) write();
    });
  }, [sync, dated]);
  return <span ref={ref} className="min-w-[7.5rem] font-mono text-[12px] text-ink tabular-nums whitespace-pre" />;
}

export function ProToolbar({
  site,
  onStep,
  onToggle,
  narrow,
  timeZone,
  onArchive,
  onGuide,
}: {
  site: RadarSite;
  onStep: (d: number) => void;
  onToggle: () => void;
  narrow: boolean;
  timeZone?: string;
  onArchive: () => void;
  /** Opens the optional guide (only shown while its button is switched on). */
  onGuide: () => void;
}) {
  const t = useT();
  const { sync } = usePro();
  const playing = useProSync(sync, (s) => s.playing);
  const layout = useProStore((s) => s.layout);
  const setLayout = useProStore((s) => s.setLayout);
  const tool = useProStore((s) => s.tool);
  const setTool = useProStore((s) => s.setTool);
  const frames = useProStore((s) => s.frames);
  const setFrames = useProStore((s) => s.setFrames);
  const speed = useProStore((s) => s.speed);
  const setSpeed = useProStore((s) => s.setSpeed);
  const pinned = useProStore((s) => s.site);
  const setSite = useProStore((s) => s.setSite);
  const guideButton = useProStore((s) => s.guideButton);
  const loc = useAppStore((s) => s.location);
  const archived = useAppStore((s) => s.archiveAt != null);
  const sites = useMemo(() => {
    const near = nearestSites(loc, 40);
    return near.some((s) => s.icao === site.icao) ? near : [{ ...site, distanceKm: 0 }, ...near];
  }, [loc, site]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-canvas/95 px-2 py-1.5 text-[12px]">
      <div data-tour="layout" role="radiogroup" aria-label={t("Panel layout")} className="flex items-center rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5">
        {LAYOUTS.filter((l) => !narrow || l === "1x1" || l === "1x2").map((l) => {
          const Icon = LAYOUT_ICON[l];
          return (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={layout === l}
              aria-label={l}
              title={l}
              onClick={() => setLayout(l)}
              className={cn("grid size-7 place-items-center rounded-[4px] pointer-coarse:size-10", layout === l ? "bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-ink-3 hover:text-ink")}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          );
        })}
      </div>

      <label data-tour="site" className="flex items-center gap-1.5">
        <Layers className="size-3.5 text-ink-3" aria-hidden />
        <span className="sr-only">{t("Radar site")}</span>
        <select value={pinned ?? ""} onChange={(e) => setSite(e.target.value || null)} className="max-w-[12rem] rounded-[4px] border border-line bg-surface-2 px-1.5 py-1 font-mono text-ink">
          <option value="">{t("Nearest ({site})", { site: nearestSites(loc, 1)[0]!.icao })}</option>
          {sites.map((s) => (
            <option key={s.icao} value={s.icao}>
              {s.icao} · {s.place}, {s.state}
            </option>
          ))}
        </select>
      </label>

      <div data-tour="tools" role="radiogroup" aria-label={t("Tool")} className="flex items-center rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5">
        {TOOLS.map(({ id, label, Icon, hint }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tool === id}
            title={`${t(label)}: ${t(hint)}`}
            onClick={() => setTool(id)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-[4px] px-2 pointer-coarse:h-10",
              tool === id ? "bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-ink-3 hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">{t(label)}</span>
          </button>
        ))}
      </div>

      <ArchiveStrip timeZone={timeZone} onPick={onArchive} variant="inline" />

      <div className="ml-auto flex items-center gap-1">
        {guideButton && (
          <button
            type="button"
            data-tour="guide"
            onClick={onGuide}
            title={t("Professional mode guide")}
            className="flex h-7 items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 text-ink-2 hover:text-ink pointer-coarse:h-10"
          >
            <BookOpen className="size-3.5" aria-hidden />
            <span className="max-sm:sr-only">{t("Guide")}</span>
          </button>
        )}
        {!archived && (
          <IconButton size="sm" label={t("Radar archive")} onClick={onArchive} data-tour="archive">
            <History className="size-4" aria-hidden />
          </IconButton>
        )}
        <div data-tour="loop" className="flex items-center gap-1">
          <IconButton size="sm" label={t("Previous frame")} onClick={() => onStep(-1)}>
            <SkipBack className="size-4" aria-hidden />
          </IconButton>
          <IconButton size="sm" label={playing ? t("Pause") : t("Play")} onClick={onToggle}>
            {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          </IconButton>
          <IconButton size="sm" label={t("Next frame")} onClick={() => onStep(1)}>
            <SkipForward className="size-4" aria-hidden />
          </IconButton>
          <LoopClock dated={archived} />
          <select aria-label={t("Frames")} value={frames} onChange={(e) => setFrames(Number(e.target.value))} className="rounded-[4px] border border-line bg-surface-2 px-1 py-1 font-mono text-ink">
            {[6, 8, 10, 12, 16, 20].map((n) => (
              <option key={n} value={n}>
                {n}f
              </option>
            ))}
          </select>
          <select aria-label={t("Speed")} value={speed} onChange={(e) => setSpeed(Number(e.target.value) as 0.5 | 1 | 2)} className="rounded-[4px] border border-line bg-surface-2 px-1 py-1 font-mono text-ink">
            {[0.5, 1, 2].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
