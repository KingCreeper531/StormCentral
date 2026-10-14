"use client";

import { Radio } from "lucide-react";
import { tagLabel } from "@/lib/alerts";
import type { WeatherAlert } from "@/lib/api/types";
import type { AlertReports } from "@/lib/alert-reports";
import type { Translator } from "@/lib/i18n/core";
import { eventName } from "@/lib/i18n/nws-events";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { useFormat } from "@/hooks/use-format";
import { EmptyState } from "../ui/misc";
import { alertUntil } from "./alert-list";

function timeLeft(a: WeatherAlert, now: number, t: Translator): string {
  const min = Math.round((Date.parse(a.ends ?? a.expires) - now) / 60_000);
  if (!Number.isFinite(min) || min <= 0) return t("Ending");
  if (min < 60) return t("{n} min left", { n: min });
  const h = Math.floor(min / 60);
  return h >= 24 ? t("{n} d left", { n: Math.round(h / 24) }) : t("{h} h {m} min left", { h, m: min % 60 });
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
  const t = useT();
  if (!items.length) return <EmptyState title={emptyTitle} />;
  return (
    <ul className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3" aria-label={t("Warnings")}>
      {items.map((a) => {
        const r = reportsFor(a);
        const event = eventName(t.lang, a.event);
        const facts = [
          r.tornadoes ? t.plural(r.tornadoes, "{n} tornado", "{n} tornadoes") : null,
          r.maxHailIn ? t("{size} hail", { size: fmt.precip(r.maxHailIn * 25.4) }) : null,
          r.maxWindMph ? t("{speed} wind", { speed: fmt.wind(r.maxWindMph * 0.44704) }) : null,
        ].filter(Boolean);
        const selected = selectedId === a.id;
        const reports = r.reports.length > 0;
        const tag = reports ? null : a.tags[0];
        return (
          <li key={a.id} className="aspect-square min-w-0">
            <button
              type="button"
              onClick={() => onSelect(a)}
              aria-current={selected ? "true" : undefined}
              title={t("{event} until {time}", { event, time: alertUntil(a, timeZone, t.locale) })}
              className={cn(
                "relative flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-panel)] border p-2.5 text-left transition-colors",
                selected ? "border-accent" : "border-line hover:border-line-strong",
              )}
              style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${a.color} 30%, var(--color-surface-1)) 0%, var(--color-surface-1) 75%)` }}
            >
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: a.color }} aria-hidden />
              {/* A fixed-size square: the name gets two lines when more rows follow (long names, e.g. in Spanish,
                  would otherwise push rows over each other), and the damage tag gives way to spotter reports. */}
              <span className={cn("mt-1 min-h-0 text-[13px] leading-[1.2] font-semibold text-ink", tag || reports ? "line-clamp-2" : "line-clamp-3")}>{event}</span>
              {tag && <span className="mt-1 shrink-0 truncate text-[10px] font-medium tracking-wide text-ink-2 uppercase">{t(tagLabel(tag))}</span>}
              <span className="mt-auto shrink-0 truncate text-[11px] text-ink-2">{firstArea(a.areaDesc)}</span>
              <span className="shrink-0 truncate text-[11px] text-ink-3 tabular">{timeLeft(a, now, t)}</span>
              {reports && (
                <span className="mt-1 flex min-w-0 shrink-0 items-center gap-1 text-[11px] font-medium text-ink tabular">
                  <Radio className="size-3 shrink-0 text-accent" aria-hidden />
                  <span className="truncate">
                    {t.plural(r.reports.length, "{n} report", "{n} reports")}
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
