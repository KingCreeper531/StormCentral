"use client";

import { Radio } from "lucide-react";
import { tagLabel } from "@/lib/alerts";
import type { WeatherAlert } from "@/lib/api/types";
import type { AlertReports } from "@/lib/alert-reports";
import { cn } from "@/lib/utils";
import { useFormat } from "@/hooks/use-format";
import { EmptyState } from "../ui/misc";
import { alertUntil } from "./alert-list";

function timeLeft(a: WeatherAlert, now: number): string {
  const min = Math.round((Date.parse(a.ends ?? a.expires) - now) / 60_000);
  if (!Number.isFinite(min) || min <= 0) return "Ending";
  if (min < 60) return `${min} min left`;
  const h = Math.floor(min / 60);
  return h >= 24 ? `${Math.round(h / 24)} d left` : `${h} h ${min % 60} min left`;
}

/** First named place of the area description ("Cleveland, OK; McClain, OK" → "Cleveland, OK"). */
const firstArea = (areaDesc: string) => areaDesc.split(";")[0]?.trim() ?? areaDesc;

/**
 * Every warning as a square tile: hazard colour, event, area and time left,
 * plus what NWS storm reports (spotters, chasers, emergency managers) say
 * inside its polygon.
 */
export function WarningSquares({
  items,
  reportsFor,
  selectedId,
  onSelect,
  now,
  timeZone,
  emptyTitle,
}: {
  items: WeatherAlert[];
  reportsFor: (a: WeatherAlert) => AlertReports;
  selectedId: string | null;
  onSelect: (a: WeatherAlert) => void;
  now: number;
  timeZone: string | undefined;
  emptyTitle: string;
}) {
  const fmt = useFormat();
  if (!items.length) return <EmptyState title={emptyTitle} />;
  return (
    <ul className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3" aria-label="Warnings">
      {items.map((a) => {
        const r = reportsFor(a);
        const facts = [
          r.tornadoes ? `${r.tornadoes} tornado${r.tornadoes > 1 ? "es" : ""}` : null,
          r.maxHailIn ? `${fmt.precip(r.maxHailIn * 25.4)} hail` : null,
          r.maxWindMph ? `${fmt.wind(r.maxWindMph * 0.44704)} wind` : null,
        ].filter(Boolean);
        const selected = selectedId === a.id;
        return (
          <li key={a.id} className="aspect-square min-w-0">
            <button
              type="button"
              onClick={() => onSelect(a)}
              aria-current={selected ? "true" : undefined}
              title={`${a.event} until ${alertUntil(a, timeZone)}`}
              className={cn(
                "relative flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-panel)] border p-2.5 text-left transition-colors",
                selected ? "border-accent" : "border-line hover:border-line-strong",
              )}
              style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${a.color} 30%, var(--color-surface-1)) 0%, var(--color-surface-1) 75%)` }}
            >
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: a.color }} aria-hidden />
              <span className="mt-1 line-clamp-3 text-[13px] leading-[1.2] font-semibold text-ink">{a.event}</span>
              {a.tags[0] && <span className="mt-1 truncate text-[10px] font-medium tracking-wide text-ink-2 uppercase">{tagLabel(a.tags[0])}</span>}
              <span className="mt-auto truncate text-[11px] text-ink-2">{firstArea(a.areaDesc)}</span>
              <span className="truncate text-[11px] text-ink-3 tabular">{timeLeft(a, now)}</span>
              {r.reports.length > 0 && (
                <span className="mt-1 flex min-w-0 items-center gap-1 text-[11px] font-medium text-ink tabular">
                  <Radio className="size-3 shrink-0 text-accent" aria-hidden />
                  <span className="truncate">
                    {r.reports.length} report{r.reports.length > 1 ? "s" : ""}
                    {facts.length ? ` · ${facts[0]}` : ""}
                  </span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
