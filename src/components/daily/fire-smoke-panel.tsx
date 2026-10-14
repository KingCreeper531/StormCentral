"use client";

import { Flame, Map as MapIcon } from "lucide-react";
import { useMemo } from "react";
import { useLocalAlerts, useRecentPrecip, useWildfires } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { FEATURED_PLUGINS } from "@/lib/addons/featured";
import type { AirQuality, Forecast } from "@/lib/api/open-meteo";
import { fireDays, FIRE_LEVELS, smokeOutlook } from "@/lib/fire-weather";
import { compassPoint } from "@/lib/geo";
import { eventName } from "@/lib/i18n/nws-events";
import { useT } from "@/lib/i18n/use-t";
import { rainTotals } from "@/lib/rainfall";
import { pm25ToAqi, usAqiCategory } from "@/lib/science/air";
import { cn } from "@/lib/utils";
import { clockIn, fmtIn } from "@/lib/weather/view";
import { useAddonsStore } from "@/store/addons-store";
import { useAppStore } from "@/store/app-store";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";

const FIRE_EVENT = /red flag|fire|smoke|air quality|air stagnation/i;
const LEVEL_COLOR = ["var(--color-go)", "var(--color-caution)", "var(--color-nogo)", "#a855f7"] as const;
const WILDFIRES = FEATURED_PLUGINS.find((p) => p.id.endsWith("/plugins/wildfires/stormcentral.json"));

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Turn on the bundled Wildfires plugin (perimeters and fire starts) and open the radar map. */
function showFiresOnMap() {
  if (!WILDFIRES) return;
  const st = useAddonsStore.getState();
  if (!st.plugins.some((p) => p.id === WILDFIRES.id)) useAddonsStore.getState().install(WILDFIRES);
  useAddonsStore.getState().setPlugin(WILDFIRES.id, { enabled: true });
  useAddonsStore.getState().setLayerVisible(WILDFIRES.id, "fire-incidents", true);
  useAppStore.getState().setMode("severe");
}

/**
 * Fire weather for the next three days (humidity and wind, hour by hour),
 * smoke and haze, fire-weather alerts and active wildfires nearby.
 */
export function FireSmokePanel({ f, air, now, className }: { f: Forecast; air: AirQuality | undefined; now: number; className?: string }) {
  const t = useT();
  const fmt = useFormat();
  const alerts = useLocalAlerts();
  const fires = useWildfires();
  const recent = useRecentPrecip();
  const fireAlerts = useMemo(() => (alerts.data?.alerts ?? []).filter((a) => FIRE_EVENT.test(a.event)).sort((a, b) => b.rank - a.rank), [alerts.data]);
  const days = fireDays(f, now, 3);
  const smoke = air ? smokeOutlook(air, now) : null;
  const dry = recent.data ? rainTotals(recent.data, now).dryDays : null;
  const dayFmt = fmtIn(f.timezone, { weekday: "short" }, t.locale);
  const acresFmt = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 0 });
  const nearby = fires.data?.fires ?? [];
  const aqiNow = smoke?.now != null ? usAqiCategory(pm25ToAqi(smoke.now)) : null;

  return (
    <Panel
      title={t("Fire and smoke")}
      subtitle={t("Fire weather from humidity and wind; smoke from PM2.5")}
      className={className}
      action={
        WILDFIRES && nearby.length > 0 ? (
          <Button size="sm" onClick={showFiresOnMap}>
            <MapIcon className="size-3.5" aria-hidden />
            {t("Map")}
          </Button>
        ) : undefined
      }
    >
      {fireAlerts.length > 0 && (
        <ul className="mb-4 space-y-1.5">
          {fireAlerts.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 py-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: a.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{eventName(t.lang, a.event)}</span>
                <span className="block truncate text-xs text-ink-3">{t("Until {time}", { time: clockIn(f.timezone, a.ends ?? a.expires, t.locale) })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="label">{t("Fire weather")}</p>
      <ol className="mt-1.5 grid grid-cols-3 gap-2">
        {days.map((d, i) => (
          <li key={d.time} className="min-w-0 rounded-[var(--radius-control)] border border-line px-2.5 py-2">
            <p className="text-[11px] text-ink-3">{i === 0 ? t("Today") : dayFmt.format(d.time)}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: LEVEL_COLOR[d.level] }} />
              {sentence(t(FIRE_LEVELS[d.level].toLowerCase()))}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-3 tabular">{t("Humidity {pct}", { pct: fmt.percent(d.minRh) })}</p>
            <p className="text-[11px] leading-snug text-ink-3 tabular">{t("Gusts {wind}", { wind: fmt.wind(d.maxGust) })}</p>
          </li>
        ))}
      </ol>
      {dry != null && dry >= 3 && <p className="mt-1.5 text-xs text-ink-3">{t("{n} days since meaningful rain, so vegetation is drying out.", { n: dry })}</p>}

      {smoke && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="label">{t("Smoke and haze")}</p>
            {smoke.now != null && (
              <p className="text-xs text-ink-3 tabular">
                PM2.5 {Math.round(smoke.now)} µg/m³{aqiNow ? `, ${t(aqiNow.short)}` : ""}
              </p>
            )}
          </div>
          <p className="mt-1 text-[15px] font-medium text-ink">{t(smoke.label)}</p>
          <p className="text-xs leading-relaxed text-ink-2">{t(smoke.detail)}</p>
          {smoke.peak != null && smoke.now != null && smoke.peak > Math.max(15, smoke.now * 1.5) && smoke.peakTime && (
            <p className="mt-1 text-xs font-medium text-ink">
              {t("Worsening: up to {n} µg/m³ around {day} {time}", {
                n: Math.round(smoke.peak),
                day: dayFmt.format(smoke.peakTime),
                time: clockIn(f.timezone, smoke.peakTime, t.locale),
              })}
            </p>
          )}
        </div>
      )}

      {fires.data && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="label">{t("Active wildfires nearby")}</p>
          {nearby.length === 0 ? (
            <p className="mt-1 text-xs text-ink-3">{t("None reported within {distance}.", { distance: fmt.distanceKm(fires.data.radiusKm) })}</p>
          ) : (
            <ul className="mt-1">
              {nearby.slice(0, 4).map((w) => (
                <li key={`${w.name}-${w.lat}-${w.lon}`} className="flex items-baseline justify-between gap-3 border-t border-line py-2 first:border-t-0">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <Flame className="size-3.5 shrink-0 translate-y-0.5 text-nogo" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{w.name === "Unnamed fire" ? t(w.name) : w.name}</span>
                      <span className="block truncate text-xs text-ink-3 tabular">
                        {w.acres != null
                          ? w.contained != null
                            ? t("{acres} acres, {pct}% contained", { acres: acresFmt.format(w.acres), pct: Math.round(w.contained) })
                            : t("{acres} acres", { acres: acresFmt.format(w.acres) })
                          : w.contained != null
                            ? t("Size unknown, {pct}% contained", { pct: Math.round(w.contained) })
                            : t("Size unknown")}
                      </span>
                    </span>
                  </span>
                  <span className={cn("shrink-0 text-xs tabular", w.distanceKm < 40 ? "font-medium text-nogo" : "text-ink-2")}>
                    {fmt.distanceKm(w.distanceKm)} {t(compassPoint(w.bearingDeg))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {nearby.length > 4 && <p className="mt-1 text-xs text-ink-3">{t("and {n} more", { n: nearby.length - 4 })}</p>}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-3">
        {t("Guidance only. Official fire danger comes from your local NWS office's Red Flag Warnings and fire agencies.")}
      </p>
    </Panel>
  );
}
