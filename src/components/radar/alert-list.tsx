"use client";

import { CircleAlert } from "lucide-react";
import { useFormat } from "@/hooks/use-format";
import { tagLabel } from "@/lib/alerts";
import type { WeatherAlert } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { clockIn } from "@/lib/weather/view";
import { EmptyState } from "../ui/misc";
import { sentenceCase } from "./radar-legend";

export interface RankedAlert {
  alert: WeatherAlert;
  distanceKm: number;
  inside: boolean;
}

/** Clock time the alert ends ("5:45 PM") in the selected location's zone. */
export const alertUntil = (a: WeatherAlert, timeZone: string | undefined) => clockIn(timeZone, a.ends ?? a.expires);

/** Hazard colour as the 8 px square swatch (the one hazard-colour encoding in lists, peek and details). */
export function HazardSwatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", className)} style={{ background: color }} />;
}

/**
 * NWS impact tag as a small outlined chip. NWS sends tags in capitals
 * ("TORNADO EMERGENCY"); they are shown in sentence case, except acronyms.
 * Life-threatening emergencies get an icon rather than relying on caps.
 */
export function AlertTag({ children }: { children: React.ReactNode }) {
  const raw = typeof children === "string" ? children : null;
  const emergency = !!raw && /EMERGENCY/i.test(raw);
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-line px-1.5 py-px text-[11px] leading-4 font-medium text-ink-2">
      {emergency && <CircleAlert className="size-3 text-nogo" aria-hidden />}
      {raw ? (raw === "PDS" ? raw : sentenceCase(raw)) : children}
    </span>
  );
}

/** Dense warning rows: hazard swatch, event, tags, area, distance and expiry. */
export function AlertList({
  items,
  selectedId,
  onSelect,
  timeZone,
}: {
  items: RankedAlert[];
  selectedId: string | null;
  onSelect: (a: WeatherAlert) => void;
  /** IANA zone of the selected location; times use the device's zone when omitted. */
  timeZone: string | undefined;
}) {
  const fmt = useFormat();
  if (!items.length) return <EmptyState title={`No active warnings within ${fmt.distanceKm(500)}`} />;
  return (
    <ul className="divide-y divide-line">
      {items.map(({ alert: a, distanceKm, inside }) => {
        const selected = selectedId === a.id;
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onSelect(a)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "flex w-full gap-2.5 border-l-2 py-2.5 pr-4 pl-3.5 text-left transition-colors",
                selected ? "border-accent bg-surface-2" : "border-transparent hover:bg-surface-2",
              )}
            >
              <HazardSwatch color={a.color} className="mt-1.5" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="min-w-0 text-[13px] leading-5 font-semibold text-ink">{a.event}</span>
                  {a.tags.slice(0, 2).map((t) => (
                    <AlertTag key={t}>{tagLabel(t)}</AlertTag>
                  ))}
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink-3">{a.areaDesc}</span>
                <span className="mt-0.5 flex items-baseline justify-between gap-3 text-xs tabular">
                  <span className={inside ? "font-medium text-ink-2" : "text-ink-3"}>{inside ? "Over your location" : `${fmt.distanceKm(distanceKm)} away`}</span>
                  <span className="shrink-0 text-ink-3">Until {alertUntil(a, timeZone)}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
