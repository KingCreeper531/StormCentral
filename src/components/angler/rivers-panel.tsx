"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { RiverSite } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useFormat } from "@/hooks/use-format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { TimeSeriesChart } from "../charts/time-series";
import { EmptyState, ErrorNote, Skeleton, Stat } from "../ui/misc";
import { Panel } from "../ui/panel";

const signed = (v: number, digits: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

/** USGS reports discharge as "ft3/s"; typeset it properly. */
const unitLabel = (u?: string) => (u === "ft3/s" ? "ft³/s" : (u ?? ""));

/**
 * Nearby USGS gauges. Wide screens: list on the left, detail on the right.
 * Narrower screens: one column, with the detail opened directly under the
 * selected row so the selection and its readings stay together.
 */
export function RiversPanel({
  sites,
  selected,
  onSelect,
  error,
  loading,
  timeZone,
  className,
}: {
  sites: RiverSite[];
  selected: RiverSite | null;
  onSelect: (id: string) => void;
  error: unknown;
  loading: boolean;
  timeZone: string;
  className?: string;
}) {
  const fmt = useFormat();
  const wide = useMediaQuery("(min-width: 1024px)");

  return (
    <Panel title="Rivers near you" subtitle="USGS real-time stream gauges" className={className}>
      {error ? (
        <ErrorNote error={error} what="river gauges" />
      ) : loading ? (
        <Skeleton className="h-40" />
      ) : !sites.length ? (
        <EmptyState title="No active stream gauges within 60 km">USGS gauges cover the United States. Try a location near a river.</EmptyState>
      ) : (
        <div className="-mx-4 -mb-4 grid grid-cols-1 border-t border-line sm:-mx-5 sm:-mb-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ul aria-label="Stream gauges" className="divide-y divide-line lg:border-r lg:border-line">
            {sites.map((s) => {
              const active = s.id === selected?.id;
              return (
                <li key={s.id} className={cn("border-l-2", active ? "border-l-accent" : "border-l-transparent")}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2.5 pr-4 pl-3.5 text-left transition-colors sm:pr-5 sm:pl-[18px] pointer-coarse:min-h-11",
                      active ? "bg-surface-2" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{s.name}</span>
                      <span className="block text-xs text-ink-3 tabular">{fmt.distanceKm(s.distanceKm)} away</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-[13px] font-medium whitespace-nowrap text-ink tabular">
                        {s.discharge ? `${Math.round(s.discharge.latest).toLocaleString()} ${unitLabel(s.discharge.unit)}` : "—"}
                      </span>
                      {s.discharge?.change24h != null && <ChangeText v={s.discharge.change24h} />}
                    </span>
                  </button>
                  {active && !wide && (
                    <div className="pt-3 pr-4 pb-4 pl-3.5 sm:pr-5 sm:pl-[18px]">
                      <RiverDetail site={s} timeZone={timeZone} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {wide && selected && (
            <div className="min-w-0 p-5">
              <RiverDetail site={selected} timeZone={timeZone} showName />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** 24 h discharge change: arrow + percentage; colour is only a secondary cue. */
function ChangeText({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  if (pct === 0) return <span className="block text-xs text-ink-3">Steady</span>;
  const Icon = pct > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn("flex items-center justify-end gap-0.5 text-xs whitespace-nowrap tabular", Math.abs(pct) < 5 ? "text-ink-3" : "text-ink-2")}>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">{pct > 0 ? "Up" : "Down"}</span>
      {Math.abs(pct)}% in 24 h
    </span>
  );
}

function RiverDetail({ site, timeZone, showName = false }: { site: RiverSite; timeZone: string; showName?: boolean }) {
  const fmt = useFormat();
  const q = site.discharge;
  const h = site.gageHeight;
  return (
    <div className="min-w-0">
      {showName && <h3 className="text-sm font-semibold text-ink">{site.name}</h3>}
      <p className={cn("font-mono text-xs text-ink-3", showName && "mt-0.5")}>USGS {site.id}</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat
          label="Discharge"
          value={q ? `${Math.round(q.latest).toLocaleString()} ${unitLabel(q.unit)}` : "—"}
          sub={q?.change24h != null ? `${signed(q.change24h * 100, 0)}% in 24 h` : undefined}
        />
        <Stat
          label="Gage height"
          value={h ? `${h.latest.toFixed(2)} ${h.unit}` : "—"}
          sub={h?.delta24h != null ? `${signed(h.delta24h, 2)} in 24 h` : undefined}
        />
        <Stat label="Water temp" value={site.waterTemp ? fmt.temp(site.waterTemp.latest, true) : "—"} />
      </div>
      {q && q.series.length > 2 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="label mb-1">Discharge, last 48 hours ({unitLabel(q.unit)})</p>
          <TimeSeriesChart
            ariaLabel={`Discharge at ${site.name}, last 48 hours`}
            times={q.series.map((p) => p.t)}
            height={130}
            timeZone={timeZone}
            series={[
              {
                key: "q",
                label: `Discharge (${unitLabel(q.unit)})`,
                color: "var(--color-series-1)",
                values: q.series.map((p) => p.v),
                kind: "area",
                format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
