"use client";

import { useMemo, useState } from "react";
import type { AirQuality } from "@/lib/api/open-meteo";
import type { BBox } from "@/lib/geo";
import { bestOutdoorWindow, pm25ToAqi, pollenLevel, US_AQI_CATEGORIES, usAqiCategory, type PollenType } from "@/lib/science/air";
import { fmtIn } from "@/lib/weather/view";
import { cn } from "@/lib/utils";
import { useAirGrid, useAirQuality } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { useAppStore } from "@/store/app-store";
import { TimeSeriesChart } from "../charts/time-series";
import { HeatLayer } from "../map/layers/heat-layer";
import { UserMarker } from "../map/layers/user-marker";
import { MapView } from "../map/map-view";
import { GlassCard } from "../ui/glass-card";
import { EmptyState, ErrorNote, Skeleton } from "../ui/misc";
import { Segmented } from "../ui/segmented";

const POLLUTANTS = [
  { key: "pm25", label: "PM2.5", unit: "µg/m³" },
  { key: "pm10", label: "PM10", unit: "µg/m³" },
  { key: "o3", label: "Ozone", unit: "µg/m³" },
  { key: "no2", label: "NO₂", unit: "µg/m³" },
  { key: "so2", label: "SO₂", unit: "µg/m³" },
  { key: "co", label: "CO", unit: "µg/m³" },
] as const;

const POLLEN: { key: PollenType; label: string }[] = [
  { key: "grass", label: "Grass" },
  { key: "birch", label: "Birch" },
  { key: "alder", label: "Alder" },
  { key: "olive", label: "Olive" },
  { key: "ragweed", label: "Ragweed" },
  { key: "mugwort", label: "Mugwort" },
];

const LEVEL_STYLE: Record<string, string> = {
  none: "bg-white/5 text-ink-3",
  low: "bg-emerald-500/15 text-emerald-200",
  moderate: "bg-yellow-400/15 text-yellow-100",
  high: "bg-orange-500/20 text-orange-100",
  "very high": "bg-red-500/25 text-red-100",
};

function nowIndex(a: AirQuality, now: number) {
  const t = now / 1000;
  let i = 0;
  while (i + 1 < a.hourly.time.length && a.hourly.time[i + 1]! <= t) i++;
  return i;
}

export function AirMode() {
  const air = useAirQuality(true);
  const loc = useAppStore((s) => s.location);
  const layer = useAppStore((s) => s.airLayer);
  const setLayer = useAppStore((s) => s.setAirLayer);
  const now = useNow(60_000);
  const [bbox, setBbox] = useState<BBox | null>(null);
  const grid = useAirGrid(bbox, layer);
  const a = air.data;

  const view = useMemo(() => {
    if (!a) return null;
    const i = nowIndex(a, now);
    const end = Math.min(a.hourly.time.length, i + 48);
    const idx = Array.from({ length: end - i }, (_, k) => i + k);
    return {
      i,
      idx,
      times: idx.map((k) => a.hourly.time[k]! * 1000),
      aqi: idx.map((k) => a.hourly.usAqi[k] ?? null),
      best: bestOutdoorWindow(a.hourly.time, a.hourly.usAqi, now / 1000, 2),
    };
  }, [a, now]);

  if (air.error && !a) return <ErrorNote error={air.error} what="air quality" />;

  const aqi = view && a ? a.hourly.usAqi[view.i] : null;
  const cat = usAqiCategory(aqi);
  const timeFmt = fmtIn(a?.timezone, { weekday: "short", hour: "numeric" });
  const pollenAvailable = a && view ? POLLEN.some((p) => a.hourly[p.key][view.i] != null) : false;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <section className="glass relative h-[420px] overflow-hidden rounded-[var(--radius-pane)] lg:col-span-8" aria-label="Air quality map">
        <MapView center={loc} zoom={6.2} onViewChange={(b) => setBbox(b)}>
          <HeatLayer grid={grid.data ?? null} />
          <UserMarker lat={loc.lat} lon={loc.lon} />
        </MapView>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-4">
          <div className="glass-strong pointer-events-auto rounded-xl px-3 py-2">
            <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Model field · CAMS via Open-Meteo</p>
            <Segmented
              ariaLabel="Heatmap variable"
              size="sm"
              className="mt-1.5"
              value={layer}
              onChange={setLayer}
              options={[
                { value: "us_aqi", label: "US AQI" },
                { value: "pm2_5", label: "PM2.5" },
              ]}
            />
          </div>
          {grid.isFetching && <span className="glass-strong rounded-full px-3 py-1 text-[11px] text-ink-2">Sampling grid…</span>}
        </div>
        <ul className="glass-strong absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-[10px] text-ink-2" aria-label="AQI categories">
          {US_AQI_CATEGORIES.map((c) => (
            <li key={c.level} className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm" style={{ background: c.color }} />
              {c.short}
            </li>
          ))}
        </ul>
      </section>

      <GlassCard className="lg:col-span-4" eyebrow="US AQI · now" title={cat?.label ?? "Air quality"}>
        {!a || !view ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="flex items-end gap-3">
              <p className="text-6xl font-semibold tabular">{aqi != null ? Math.round(aqi) : "—"}</p>
              {cat && <span className="mb-2 h-3 w-12 rounded-full" style={{ background: cat.color }} aria-hidden />}
            </div>
            <p className="mt-2 text-sm text-ink-2">{cat?.advice}</p>
            {view.best && (
              <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-ink-2">
                <span className="font-semibold text-ink">Cleanest window:</span> {timeFmt.format(view.best.start * 1000)} – {fmtIn(a.timezone, { hour: "numeric" }).format(view.best.end * 1000)} (AQI ≈ {Math.round(view.best.meanAqi)})
              </p>
            )}
            <dl className="mt-4 grid grid-cols-3 gap-2">
              {POLLUTANTS.map((p) => {
                const v = a.hourly[p.key][view.i];
                return (
                  <div key={p.key} className="rounded-xl bg-white/[0.035] px-2.5 py-2">
                    <dt className="text-[10px] font-medium text-ink-3">{p.label}</dt>
                    <dd className="text-sm font-semibold tabular">{v != null ? (v >= 100 ? Math.round(v) : v.toFixed(1)) : "—"}</dd>
                    {p.key === "pm25" && v != null && <dd className="text-[10px] text-ink-3">AQI {pm25ToAqi(v)}</dd>}
                  </div>
                );
              })}
            </dl>
            <p className="mt-2 text-[10px] text-ink-3">Concentrations in µg/m³ (model, hourly).</p>
          </>
        )}
      </GlassCard>

      <GlassCard className="lg:col-span-8" eyebrow="Next 48 hours" title="AQI forecast">
        {view && a ? (
          <>
            <TimeSeriesChart
              ariaLabel="US AQI, next 48 hours"
              times={view.times}
              height={170}
              timeZone={a.timezone}
              yDomain={[0, Math.max(100, ...view.aqi.map((v) => v ?? 0))]}
              thresholds={[{ value: 100, label: "USG threshold", color: "#ff7e00" }]}
              series={[{ key: "aqi", label: "US AQI", color: "var(--color-series-1)", values: view.aqi, kind: "bar", format: (v) => `${Math.round(v)}` }]}
            />
            <TimeSeriesChart
              className="mt-4"
              ariaLabel="UV index, next 48 hours"
              times={view.times}
              height={90}
              timeZone={a.timezone}
              yDomain={[0, 11]}
              series={[{ key: "uv", label: "UV index", color: "var(--color-series-2)", values: view.idx.map((k) => a.hourly.uv[k] ?? null), kind: "area", format: (v) => v.toFixed(1) }]}
              legend
            />
          </>
        ) : (
          <Skeleton className="h-48" />
        )}
      </GlassCard>

      <GlassCard className="lg:col-span-4" eyebrow="Allergy · NAB scale" title="Pollen">
        {!a || !view ? (
          <Skeleton className="h-40" />
        ) : !pollenAvailable ? (
          <EmptyState title="No pollen model for this region">
            Open pollen forecasts (CAMS) cover Europe. Elsewhere, StormCentral shows the air-quality components that most affect allergy and asthma: PM2.5, ozone and NO₂.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {POLLEN.map((p) => {
              const v = a.hourly[p.key][view.i];
              const lvl = pollenLevel(p.key, v);
              return (
                <li key={p.key} className="flex items-center justify-between rounded-xl bg-white/[0.035] px-3 py-2 text-sm">
                  <span>{p.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-ink-3 tabular">{v != null ? `${Math.round(v)} gr/m³` : "—"}</span>
                    {lvl && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", LEVEL_STYLE[lvl])}>{lvl}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
