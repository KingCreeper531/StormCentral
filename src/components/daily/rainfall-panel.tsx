"use client";

import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { useFloodGauges, useLocalAlerts, useRecentPrecip } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import type { Forecast } from "@/lib/api/open-meteo";
import type { WeatherAlert } from "@/lib/api/types";
import { tagLabel } from "@/lib/alerts";
import { floodRank, type FloodCategory, type FloodGauge } from "@/lib/feeds/flood-gauges";
import { eventName } from "@/lib/i18n/nws-events";
import { useT } from "@/lib/i18n/use-t";
import { dailyBars, rainTotals } from "@/lib/rainfall";
import { cn } from "@/lib/utils";
import { clockIn, fmtIn } from "@/lib/weather/view";
import { Skeleton } from "../ui/misc";
import { Panel } from "../ui/panel";

/** NWS hydrograph colours for each flood category (data colouring, not text). */
const FLOOD_COLOR: Record<FloodCategory, string> = { none: "#2fb344", action: "#f5d90a", minor: "#ff9900", moderate: "#ff2a2a", major: "#cc33ff" };
const FLOOD_LABEL: Record<FloodCategory, string> = { none: "Normal", action: "Near flood stage", minor: "Minor flooding", moderate: "Moderate flooding", major: "Major flooding" };

const FLOOD_EVENT = /flood|hydrologic/i;

function AlertRow({ a, timeZone }: { a: WeatherAlert; timeZone: string }) {
  const t = useT();
  const until = a.ends ?? a.expires;
  const emergency = a.tags.find((tag) => tag.includes("EMERGENCY"));
  return (
    <details className="group border-t border-line first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 py-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: a.color }} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13px] font-medium", emergency ? "text-nogo" : "text-ink")}>{emergency ? t(tagLabel(emergency)) : eventName(t.lang, a.event)}</span>
          <span className="block truncate text-xs text-ink-3">{t("Until {time}", { time: clockIn(timeZone, until, t.locale) })}</span>
        </span>
      </summary>
      <p className="pb-2.5 text-xs leading-relaxed whitespace-pre-line text-ink-2">{a.description}</p>
      {a.instruction && <p className="pb-2.5 text-xs leading-relaxed font-medium whitespace-pre-line text-ink">{a.instruction}</p>}
    </details>
  );
}

function Total({ label, mm, strong }: { label: string; mm: number | null | undefined; strong?: boolean }) {
  const fmt = useFormat();
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p className={cn("mt-0.5 tabular", strong ? "text-lg font-medium text-ink" : "text-[15px] font-medium text-ink")}>{fmt.precip(mm ?? null)}</p>
    </div>
  );
}

/** Stage against the gauge's flood ladder: ticks at action, minor, moderate and major. */
function GaugeRow({ g }: { g: FloodGauge }) {
  const t = useT();
  const fmt = useFormat();
  const obs = g.observed!;
  const cat = obs.category;
  const st = g.stages;
  const ladder = st ? [st.action, st.minor, st.moderate, st.major].filter((v): v is number => v != null) : [];
  const top = Math.max(obs.value, ...ladder) * 1.12 || 1;
  const fc = g.forecast;
  const rising = fc && fc.unit === obs.unit ? fc.value - obs.value : null;
  return (
    <li className="border-t border-line py-2.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <a href={`https://water.noaa.gov/gauges/${g.lid}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[13px] font-medium text-ink hover:underline">
          {g.name}
        </a>
        <span className="shrink-0 text-[13px] font-medium text-ink tabular">
          {obs.value.toFixed(1)} {obs.unit}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-ink-3 tabular">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: FLOOD_COLOR[cat] }} />
          <span className={cn("truncate", floodRank(cat) >= 2 && "font-medium text-ink")}>{t(FLOOD_LABEL[cat])}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{fmt.distanceKm(g.distanceKm)}</span>
        </span>
        {st?.minor != null && <span className="shrink-0">{t("Floods at {stage} {unit}", { stage: st.minor.toFixed(0), unit: g.stageUnit ?? "" })}</span>}
      </div>
      {ladder.length > 0 && (
        <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-3" role="meter" aria-label={t("{name} stage", { name: g.name })} aria-valuenow={obs.value} aria-valuemin={0} aria-valuemax={top}>
          <div className="h-full rounded-[2px]" style={{ width: `${Math.min(100, (obs.value / top) * 100)}%`, background: FLOOD_COLOR[cat] }} />
          {(["action", "minor", "moderate", "major"] as const).map((k) =>
            st?.[k] != null ? <span key={k} aria-hidden className="absolute top-0 h-full w-0.5" style={{ left: `${(st[k]! / top) * 100}%`, background: FLOOD_COLOR[k] }} /> : null,
          )}
        </div>
      )}
      {fc && floodRank(fc.category) > floodRank(cat) && (
        <p className="mt-1 text-xs font-medium text-ink">
          {t("Forecast to reach {value} {unit} ({category})", { value: fc.value.toFixed(1), unit: fc.unit, category: t(FLOOD_LABEL[fc.category]).toLowerCase() })}
        </p>
      )}
      {fc && floodRank(fc.category) <= floodRank(cat) && rising != null && Math.abs(rising) >= 0.5 && (
        <p className="mt-1 text-xs text-ink-3 tabular">
          {rising > 0
            ? t("Forecast to rise to {value} {unit}", { value: fc.value.toFixed(1), unit: fc.unit })
            : t("Forecast to fall to {value} {unit}", { value: fc.value.toFixed(1), unit: fc.unit })}
        </p>
      )}
    </li>
  );
}

/**
 * Rain that has fallen and is on the way, flood alerts, and NWS river gauges
 * with their flood stages.
 */
export function RainfallPanel({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const t = useT();
  const fmt = useFormat();
  const recent = useRecentPrecip();
  const gauges = useFloodGauges();
  const alerts = useLocalAlerts();
  const floodAlerts = useMemo(() => (alerts.data?.alerts ?? []).filter((a) => FLOOD_EVENT.test(a.event)).sort((a, b) => b.rank - a.rank), [alerts.data]);
  const r = recent.data;
  const totals = r ? rainTotals(r, now) : null;
  const bars = r ? dailyBars(r, now, 13, 3) : [];
  const maxBar = Math.max(2, ...bars.map((b) => b.mm));
  const dayFmt = fmtIn(f.timezone, { weekday: "narrow" }, t.locale);
  const dateFmt = fmtIn(f.timezone, { weekday: "short", month: "short", day: "numeric" }, t.locale);
  const barText = (time: number, mm: number, future: boolean) =>
    t(future ? "{date}: {amount} (forecast)" : "{date}: {amount}", { date: dateFmt.format(time), amount: fmt.precip(mm) });
  const g = gauges.data;

  return (
    <Panel title={t("Rainfall and flooding")} subtitle={t("Totals estimated from weather models; river levels from NOAA gauges")} className={className}>
      {floodAlerts.length > 0 && (
        <div className="mb-4 rounded-[var(--radius-control)] border border-line px-3">
          {floodAlerts.map((a) => (
            <AlertRow key={a.id} a={a} timeZone={f.timezone} />
          ))}
        </div>
      )}

      {!totals ? (
        recent.isError ? (
          <p className="text-xs text-ink-3">{t("Rain totals are unavailable right now.")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-3" aria-busy="true">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
            <Total label={t("Today")} mm={totals.today} strong />
            <Total label={t("Past 24 h")} mm={totals.last24h} strong />
            <Total label={t("Past 7 days")} mm={totals.last7d} strong />
            <Total label={t("Past hour")} mm={totals.lastHour} />
            <Total label={t("Next 24 h")} mm={totals.next24h} />
            <Total label={t("Next 3 days")} mm={totals.next72h} />
          </div>
          <p className="mt-2 text-xs text-ink-3">
            {totals.dryDays == null
              ? t("No day with 1 mm or more in the past month.")
              : totals.dryDays === 0
                ? t("Rain has fallen today.")
                : totals.dryDays === 1
                  ? t("Last rain (1 mm or more) was yesterday.")
                  : t("Last rain (1 mm or more) was {n} days ago.", { n: totals.dryDays })}
          </p>

          {bars.length > 0 && (
            <ol className="mt-3 flex h-24 items-end gap-[3px] border-t border-line pt-3" aria-label={t("Daily rainfall, past two weeks and next days")}>
              {bars.map((b) => (
                <li key={b.time} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={barText(b.time, b.mm, b.future)}>
                  <span
                    className={cn("w-full rounded-t-[2px]", b.future ? "bg-accent/40" : "bg-accent", b.today && "outline outline-1 outline-offset-1 outline-ink-3")}
                    style={{ height: `${b.mm > 0 ? Math.max(4, (b.mm / maxBar) * 100) : 1.5}%` }}
                  />
                  <span className={cn("text-[10px] leading-none tabular", b.today ? "font-semibold text-ink" : "text-ink-3")}>{dayFmt.format(b.time)}</span>
                  <span className="sr-only">{barText(b.time, b.mm, b.future)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {/* River gauges: US only; hidden when none report within range (or the service is down). */}
      {(gauges.isLoading || (g && g.total > 0)) && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="label">{t("Rivers and streams")}</p>
            {g && (
              <p className={cn("text-xs tabular", g.flooding > 0 ? "font-medium text-nogo" : "text-ink-3")}>
                {g.flooding > 0
                  ? t.plural(g.total, "{flooding} of {n} gauge flooding", "{flooding} of {n} gauges flooding", { flooding: g.flooding })
                  : t.plural(g.total, "{n} gauge, none flooding", "{n} gauges, none flooding")}
              </p>
            )}
          </div>
          {!g ? (
            <Skeleton className="mt-2 h-16" />
          ) : (
            <ul className="mt-1">
              {g.gauges.map((x) => (
                <GaugeRow key={x.lid} g={x} />
              ))}
            </ul>
          )}
          <a href="https://water.noaa.gov/" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink hover:underline">
            National Water Prediction Service
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      )}
    </Panel>
  );
}
