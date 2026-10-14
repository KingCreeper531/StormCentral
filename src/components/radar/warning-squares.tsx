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
  return h >= 24
    ? t("{n} d left", { n: Math.round(h / 24) })
    : t("{h} h {m} min left", { h, m: min % 60 });
}

/** First named place of the area description ("Cleveland, OK; McClain, OK" → "Cleveland, OK"). */
const firstArea = (areaDesc: string) =>
  areaDesc.split(";")[0]?.trim() ?? areaDesc;

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
    // Columns follow the panel's own width (a container query), not the window's: the radar panel is 280-340 px
    // wide on desktop, where three columns would make tiles too small to fit their text.
    <div className="@container">
      <ul
        className="grid grid-cols-2 gap-2 p-3 @[336px]:grid-cols-3"
        aria-label={t("Warnings")}
      >
        {items.map((a) => {
          const r = reportsFor(a);
          const event = eventName(t.lang, a.event);
          const facts = [
            r.tornadoes
              ? t.plural(r.tornadoes, "{n} tornado", "{n} tornadoes")
              : null,
            r.maxHailIn
              ? t("{size} hail", { size: fmt.precip(r.maxHailIn * 25.4) })
              : null,
            r.maxWindMph
              ? t("{speed} wind", { speed: fmt.wind(r.maxWindMph * 0.44704) })
              : null,
          ].filter(Boolean);
          const selected = selectedId === a.id;
          const reports = r.reports.length > 0;
          const tag = a.tags[0];
          return (
            <li key={a.id} className="aspect-square min-w-0">
              <button
                type="button"
                onClick={() => onSelect(a)}
                aria-current={selected ? "true" : undefined}
                title={t("{event} until {time}", {
                  event,
                  time: alertUntil(a, timeZone, t.locale),
                })}
                className={cn(
                  "relative flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-panel)] border p-2 text-left transition-colors",
                  selected
                    ? "border-accent"
                    : "border-line hover:border-line-strong",
                )}
                style={{
                  background: `linear-gradient(160deg, color-mix(in srgb, ${a.color} 30%, var(--color-surface-1)) 0%, var(--color-surface-1) 75%)`,
                }}
              >
                <span
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: a.color }}
                  aria-hidden
                />
                {/* A square at least 96 px wide (see the columns above) with fixed line heights, so its rows always fit
                  in the 80 px inside: the name gets up to two lines, and with spotter reports the report count takes
                  the place of the area. The tag (TORNADO EMERGENCY, PDS, OBSERVED...) always shows. Worst case, with a
                  tag and reports: 4 + 30 + 2 + 13 + 14 + 2 + 14 = 79. */}
                <span className="mt-1 line-clamp-2 shrink-0 text-[13px] leading-[15px] font-semibold text-ink">
                  {event}
                </span>
                {tag && (
                  <span className="mt-0.5 shrink-0 truncate text-[10px] leading-[13px] font-medium tracking-wide text-ink-2 uppercase">
                    {t(tagLabel(tag))}
                  </span>
                )}
                {!reports && (
                  <span className="mt-auto shrink-0 truncate text-[11px] leading-[14px] text-ink-2">
                    {firstArea(a.areaDesc)}
                  </span>
                )}
                <span
                  className={cn(
                    "shrink-0 truncate text-[11px] leading-[14px] text-ink-3 tabular",
                    reports && "mt-auto",
                  )}
                >
                  {timeLeft(a, now, t)}
                </span>
                {reports && (
                  <span className="mt-0.5 flex min-w-0 shrink-0 items-center gap-1 text-[11px] leading-[14px] font-medium text-ink tabular">
                    <Radio
                      className="size-3 shrink-0 text-accent"
                      aria-hidden
                    />
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
    </div>
  );
}
