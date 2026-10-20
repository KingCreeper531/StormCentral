"use client";

import { PictureInPicture2, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/use-t";
import { PRO_PRODUCT_IDS, PRO_PRODUCTS, productUsable, SAT_LATENCY_MS, type ProProduct, type ProProductId } from "@/lib/pro/products";
import { frameAt, syncTime } from "@/lib/pro/sync";
import { useProStore, type PaneConfig } from "@/store/pro-store";
import { cn } from "@/lib/utils";
import type { TiltPrefix } from "@/lib/radar/products";
import { Toggle } from "../ui/misc";
import type { PaneFeed } from "./frame-sources";
import { usePro } from "./pro-context";

const GROUPS: ProProduct["group"][] = ["Radar (site)", "Radar (volume)", "Radar (national)", "Radar (other countries)", "Satellite"];

/** The listed angle closest to `v` (or `v` itself when there's no list yet). */
const nearest = (list: readonly number[], v: number) => (list.length ? list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)) : v);

const zulu = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
};

/**
 * The frame time shown in a pane, updated straight from the loop clock (a
 * text-node write, not a render).
 */
function FrameClock({ feed, satellite }: { feed: PaneFeed; satellite: boolean }) {
  const { sync } = usePro();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const times = feed.frames.map((f) => f.time);
    const write = () => {
      if (!ref.current) return;
      const i = frameAt(times, syncTime(sync.getState()));
      // Satellite frames are stamped with the loop time they stand in for; show the scan time.
      ref.current.textContent = i < 0 ? "----Z" : zulu(times[i]! - (satellite ? SAT_LATENCY_MS : 0));
    };
    write();
    return sync.subscribe((s, prev) => {
      if (s.index !== prev.index || s.timeline !== prev.timeline) write();
    });
  }, [feed.frames, sync, satellite]);
  return <span ref={ref} className="font-mono tabular-nums" />;
}

export function PaneHeader({
  config,
  n,
  feed,
  basis,
  compact,
  volume,
  onPopOut,
}: {
  config: PaneConfig;
  n: number;
  feed: PaneFeed;
  basis: boolean;
  compact: boolean;
  /** Level II products allowed on this device. */
  volume: boolean;
  /** Move this panel to a window of its own (another monitor). */
  onPopOut?: () => void;
}) {
  const t = useT();
  const setPane = useProStore((s) => s.setPane);
  const def = PRO_PRODUCTS[config.product];
  const set = (patch: Partial<Omit<PaneConfig, "id">>) => setPane(config.id, patch);

  return (
    <div className="pointer-events-none absolute inset-x-1.5 top-1.5 z-10 flex items-start gap-1.5">
      <div className="pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-canvas/85 py-0.5 pr-1 pl-1.5 text-[11px] backdrop-blur-sm">
        <span className="shrink-0 font-semibold text-ink-3">P{n}</span>
        <select
          data-tour="pane-product"
          aria-label={t("Product for panel {n}", { n })}
          value={config.product}
          onChange={(e) => set({ product: e.target.value as ProProductId })}
          className="min-w-0 max-w-[11rem] truncate bg-transparent font-medium text-ink outline-none"
        >
          {GROUPS.map((g) => (
            <optgroup key={g} label={t(g)}>
              {PRO_PRODUCT_IDS.filter((id) => PRO_PRODUCTS[id].group === g && productUsable(id, { volume })).map((id) => (
                <option key={id} value={id}>
                  {PRO_PRODUCTS[id].short} · {t(PRO_PRODUCTS[id].label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {feed.tilts.length > 1 && (
          <select
            data-tour="pane-tilt"
            aria-label={t("Elevation tilt")}
            value={feed.tilt?.prefix ?? config.tilt}
            onChange={(e) => set({ tilt: e.target.value as TiltPrefix })}
            className="shrink-0 bg-transparent font-mono text-ink-2 outline-none"
          >
            {feed.tilts.map((x) => (
              <option key={x.prefix} value={x.prefix}>
                {x.angle}°
              </option>
            ))}
          </select>
        )}
        {def.kind === "l2" && (
          <select
            data-tour="pane-tilt"
            aria-label={t("Elevation tilt")}
            value={String(nearest(feed.elevations ?? [], config.elev))}
            onChange={(e) => set({ elev: Number(e.target.value) })}
            className="shrink-0 bg-transparent font-mono text-ink-2 outline-none"
          >
            {(feed.elevations?.length ? feed.elevations : [config.elev]).map((a) => (
              <option key={a} value={String(a)}>
                {a.toFixed(1)}°
              </option>
            ))}
          </select>
        )}
        <span className="shrink-0 text-ink-2">
          <FrameClock feed={feed} satellite={def.kind === "gibs" || def.kind === "nowcoast"} />
        </span>
        {basis && (
          <span data-tour="pane-basis" title={t("Time basis: the loop steps through this panel's scan times")} className="shrink-0 rounded-sm bg-surface-3 px-1 font-mono text-[10px] text-ink-2">
            TB
          </span>
        )}
      </div>
      {onPopOut && (
        <button
          type="button"
          data-tour="pane-popout"
          onClick={onPopOut}
          aria-label={t("Open panel {n} in a new window", { n })}
          title={t("Open panel {n} in a new window", { n })}
          className="pointer-events-auto ml-auto grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line bg-canvas/85 text-ink-2 backdrop-blur-sm hover:text-ink"
        >
          <PictureInPicture2 className="size-3.5" aria-hidden />
        </button>
      )}
      <details className={cn("group pointer-events-auto relative shrink-0", !onPopOut && "ml-auto")}>
        <summary
          data-tour="pane-settings"
          aria-label={t("Panel {n} settings", { n })}
          title={t("Panel {n} settings", { n })}
          className="grid size-7 cursor-pointer list-none place-items-center rounded-[var(--radius-control)] border border-line bg-canvas/85 text-ink-2 backdrop-blur-sm hover:text-ink [&::-webkit-details-marker]:hidden"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </summary>
        <div className="absolute top-8 right-0 w-56 space-y-3 rounded-[var(--radius-control)] border border-line bg-surface-1 p-3 text-[12px] shadow-xl">
          <label className="block">
            <span className="label">{t("Opacity")}</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(config.opacity * 100)}
              onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
          </label>
          <Toggle label={t("Warnings")} checked={config.warnings} onChange={(v) => set({ warnings: v })} />
          <Toggle label={t("Storm cells")} checked={config.cells} onChange={(v) => set({ cells: v })} />
          <Toggle label={t("Satellite map (no clouds)")} checked={config.satelliteMap} onChange={(v) => set({ satelliteMap: v })} />
          <p className={cn("text-[11px] text-ink-3", compact && "pt-1")}>{feed.source || t("Loading")}</p>
        </div>
      </details>
    </div>
  );
}
