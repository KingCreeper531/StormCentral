"use client";

import type { WeatherAlert } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useFormat } from "@/hooks/use-format";

export interface RankedAlert {
  alert: WeatherAlert;
  distanceKm: number;
  inside: boolean;
}

export function AlertList({ items, selectedId, onSelect }: { items: RankedAlert[]; selectedId: string | null; onSelect: (a: WeatherAlert) => void }) {
  const fmt = useFormat();
  if (!items.length) return <p className="rounded-2xl bg-white/[0.03] px-3 py-4 text-center text-xs text-ink-3">No active warnings within 500 km.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map(({ alert: a, distanceKm, inside }) => (
        <li key={a.id}>
          <button
            type="button"
            onClick={() => onSelect(a)}
            className={cn("flex w-full gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]", selectedId === a.id && "bg-white/[0.08]")}
          >
            <span className="mt-0.5 w-1 shrink-0 self-stretch rounded-full" style={{ background: a.color }} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1 text-[13px] font-semibold text-ink">
                {a.event}
                {a.tags.slice(0, 2).map((t) => (
                  <span key={t} className="rounded bg-white/10 px-1 text-[9px] font-bold tracking-wide">
                    {t}
                  </span>
                ))}
              </span>
              <span className="block truncate text-[11px] text-ink-3">{a.areaDesc}</span>
              <span className="text-[11px] text-ink-2">
                {inside ? "Over your location" : `${fmt.distanceKm(distanceKm)} away`} · until{" "}
                {new Date(a.ends ?? a.expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
