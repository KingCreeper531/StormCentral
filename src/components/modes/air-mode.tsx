"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { HttpError } from "@/lib/api/http";
import { fetchAirQuality, reverseGeocode, type AirQuality } from "@/lib/api/open-meteo";
import type { BBox } from "@/lib/geo";
import { bestOutdoorWindow, pm25ToAqi, pollenLevel, US_AQI_CATEGORIES, usAqiCategory, type PollenLevel, type PollenType } from "@/lib/science/air";
import { fmtIn } from "@/lib/weather/view";
import { useAirGrid, useAirQuality } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { useAppStore } from "@/store/app-store";
import { TimeSeriesChart, type SeriesDef } from "../charts/time-series";
import { HeatLayer } from "../map/layers/heat-layer";
import { UserMarker } from "../map/layers/user-marker";
import { MapView } from "../map/map-view";
import { Meter } from "../ui/meter";
import { ErrorNote, Row, Skeleton, Stat } from "../ui/misc";
import { Panel } from "../ui/panel";
import { IconButton } from "../ui/button";
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

/** Ordinal swatch beside the level text (the chip itself stays neutral). */
const LEVEL_SWATCH: Record<PollenLevel, string> = {
  none: "var(--color-line-strong)",
  low: "var(--color-go)",
  moderate: "var(--color-caution)",
  high: "#ff7e00",
  "very high": "var(--color-nogo)",
};

/** AQI category bounds drawn as ticks on the 0–300 meter. */
const AQI_TICKS = [50, 100, 150, 200];

/** The "Unhealthy for Sensitive Groups" category starts above 100. */
const USG_COLOR = US_AQI_CATEGORIES.find((c) => c.level === 2)!.color;

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function nowIndex(a: AirQuality, now: number) {
  const t = now / 1000;
  let i = 0;
  while (i + 1 < a.hourly.time.length && a.hourly.time[i + 1]! <= t) i++;
  return i;
}

/** Index and value of the highest reading in the first `hours` entries. */
function peakWithin(values: ReadonlyArray<number | null>, hours: number) {
  let best: { k: number; v: number } | null = null;
  for (let k = 0; k < Math.min(hours, values.length); k++) {
    const v = values[k];
    if (v != null && (!best || v > best.v)) best = { k, v };
  }
  return best;
}

/**
 * On touch screens the embedded map shouldn't trap vertical page scroll:
 * one finger scrolls the page, two fingers pan and zoom the map.
 */
function cooperativeOnTouch(map: MlMap) {
  if (window.matchMedia("(pointer: coarse)").matches) map.cooperativeGestures.enable();
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The colour map needs this zoom; zoomed further out it covers too much of the globe to sample well. */
const MIN_HEAT_ZOOM = 3.5;

/** Air quality at a tapped point on the map. */
function PickedAir({ lat, lon, now, onClose }: { lat: number; lon: number; now: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ["air-point", lat.toFixed(2), lon.toFixed(2)], queryFn: ({ signal }) => fetchAirQuality(lat, lon, signal), staleTime: 20 * 60_000 });
  const place = useQuery({ queryKey: ["place-name", lat.toFixed(2), lon.toFixed(2)], queryFn: ({ signal }) => reverseGeocode(lat, lon, signal), staleTime: Infinity, retry: false });
  const a = q.data;
  const i = a ? nowIndex(a, now) : 0;
  const aqi = a?.hourly.usAqi[i] ?? null;
  const cat = usAqiCategory(aqi);
  const pm = a?.hourly.pm25[i];
  const o3 = a?.hourly.o3[i];
  const name = place.data && place.data !== "My location" ? place.data : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  return (
    <div role="status" className="overlay absolute right-2 bottom-2 left-2 z-10 flex items-start gap-3 p-3 sm:right-auto sm:w-72">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{name}</p>
        {q.isLoading ? (
          <p className="mt-1 text-xs text-ink-3">Loading air quality…</p>
        ) : q.error || !a ? (
          <p className="mt-1 text-xs text-ink-3">
            {q.error instanceof HttpError && q.error.status === 429
              ? "The air quality service is busy. Try again in a minute."
              : "Couldn't load air quality here. Try again."}
          </p>
        ) : (
          <>
            <p className="mt-1 flex items-center gap-2 text-sm text-ink">
              {cat && <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: cat.color }} aria-hidden />}
              <span className="text-xl font-light tabular">{aqi != null ? Math.round(aqi) : "—"}</span>
              <span className="text-ink-2">{cat?.label ?? "US AQI"}</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3 tabular">
              PM2.5 {pm != null ? `${Math.round(pm)} µg/m³` : "—"} · Ozone {o3 != null ? `${Math.round(o3)} µg/m³` : "—"}
            </p>
          </>
        )}
      </div>
      <IconButton label="Close" size="sm" onClick={onClose} className="-mt-1 -mr-1">
        <X className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}

/**
 * Phones: current reading first, then the map, forecast and pollen.
 * Desktop: map and current reading side by side, charts and pollen below.
 */
export function AirMode() {
  const air = useAirQuality(true);
  const loc = useAppStore((s) => s.location);
  const layer = useAppStore((s) => s.airLayer);
  const setLayer = useAppStore((s) => s.setAirLayer);
  const now = useNow(60_000);
  const [mapState, setMapState] = useState<{ bbox: BBox; zoom: number } | null>(null);
  // Sample only after the map has settled, not on every step of a pan or zoom.
  const settled = useDebounced(mapState, 700);
  const heatOn = !!mapState && mapState.zoom >= MIN_HEAT_ZOOM;
  const grid = useAirGrid(heatOn && settled ? settled.bbox : null, layer);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
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
      peak: peakWithin(idx.map((k) => a.hourly.usAqi[k] ?? null), 24),
    };
  }, [a, now]);

  if (air.error && !a) return <ErrorNote error={air.error} what="air quality" />;

  const aqi = view && a ? a.hourly.usAqi[view.i] : null;
  const cat = usAqiCategory(aqi);
  const timeFmt = fmtIn(a?.timezone, { weekday: "short", hour: "numeric" });
  const hourFmt = fmtIn(a?.timezone, { hour: "numeric" });
  const pollenAvailable = a && view ? POLLEN.some((p) => a.hourly[p.key][view.i] != null) : false;
  // Outside Europe there is no pollen model: drop the panel rather than show an empty one.
  const showPollen = !a || !view || pollenAvailable;
  // Bars take their EPA category colour, like the map and the current reading.
  const aqiBars: (SeriesDef & { colorFor?: (v: number) => string }) | null = view
    ? {
        key: "aqi",
        label: "US AQI",
        color: "var(--color-series-1)",
        values: view.aqi,
        kind: "bar",
        format: (v) => `${Math.round(v)}`,
        colorFor: (v) => usAqiCategory(v)?.color ?? "var(--color-series-1)",
      }
    : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Panel title="Current air quality" subtitle="US AQI, this hour" className="lg:order-2 lg:col-span-4">
        {!a || !view ? (
          <Skeleton className="h-72" />
        ) : (
          <>
            <div className="flex items-end gap-4">
              <p className="text-5xl font-light tracking-tight text-ink tabular">{aqi != null ? Math.round(aqi) : "—"}</p>
              {cat && (
                <div className="min-w-0 pb-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: cat.color }} aria-hidden />
                    {cat.label}
                  </p>
                  <p className="label mt-0.5">US AQI</p>
                </div>
              )}
            </div>
            {aqi != null && cat && <Meter value={Math.min(aqi, 300)} max={300} color={cat.color} ticks={AQI_TICKS} label="US AQI" className="mt-3" />}
            {cat && <p className="mt-3 text-sm text-ink-2">{cat.advice}</p>}

            {(view.best || view.peak) && (
              <div className="mt-3 divide-y divide-line border-t border-line">
                {view.best && (
                  <Row
                    label="Cleanest 2 h window"
                    value={`${timeFmt.format(view.best.start * 1000)}–${hourFmt.format(view.best.end * 1000)}`}
                    sub={`AQI about ${Math.round(view.best.meanAqi)}`}
                  />
                )}
                {view.peak && (
                  <Row
                    label="Highest in next 24 h"
                    value={Math.round(view.peak.v)}
                    sub={`${timeFmt.format(view.times[view.peak.k]!)}, ${usAqiCategory(view.peak.v)?.short ?? ""}`}
                  />
                )}
              </div>
            )}

            <div className="@container mt-3 border-t border-line pt-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 @min-[20rem]:grid-cols-3">
                {POLLUTANTS.map((p) => {
                  const v = a.hourly[p.key][view.i];
                  return (
                    <Stat
                      key={p.key}
                      label={p.label}
                      value={v != null ? (v >= 100 ? Math.round(v) : v.toFixed(1)) : "—"}
                      sub={p.key === "pm25" && v != null ? `AQI ${pm25ToAqi(v)}` : undefined}
                    />
                  );
                })}
              </div>
              <p className="label mt-3">Concentrations in µg/m³, hourly model values.</p>
              {!pollenAvailable && <p className="label mt-1">No pollen model for this region (CAMS covers Europe only).</p>}
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Air quality map"
        subtitle="CAMS via Open-Meteo"
        aria-label="Air quality map"
        action={
          <Segmented
            ariaLabel="Map variable"
            size="sm"
            value={layer}
            onChange={setLayer}
            options={[
              { value: "us_aqi", label: "US AQI" },
              { value: "pm2_5", label: "PM2.5" },
            ]}
          />
        }
        className="flex flex-col lg:order-1 lg:col-span-8"
      >
        {/* The map and its legend run edge to edge under the standard header. */}
        <div className="relative -mx-4 h-72 border-y border-line sm:-mx-5 sm:h-[clamp(18rem,60dvh,420px)] lg:h-auto lg:min-h-[420px] lg:flex-1">
          <MapView
            center={loc}
            zoom={6.2}
            onViewChange={(bbox, zoom) => setMapState({ bbox, zoom })}
            onReady={(m) => {
              cooperativeOnTouch(m);
              m.on("click", (e) => setPicked({ lat: e.lngLat.lat, lon: e.lngLat.wrap().lng }));
            }}
          >
            <HeatLayer grid={heatOn ? (grid.data ?? null) : null} />
            <UserMarker lat={loc.lat} lon={loc.lon} />
          </MapView>
          {mapState && !heatOn && (
            <span className="pointer-events-none absolute top-2 left-2 rounded-[var(--radius-control)] border border-line bg-surface-1/90 px-2 py-1 text-[11px] text-ink-2">
              Zoom in to see the colour map. Tap anywhere for a reading.
            </span>
          )}
          {picked && <PickedAir lat={picked.lat} lon={picked.lon} now={now} onClose={() => setPicked(null)} />}
          {heatOn && grid.isFetching && (
            <span className="pointer-events-none absolute top-2 left-2 rounded-[var(--radius-control)] border border-line bg-surface-1/90 px-2 py-1 text-[11px] text-ink-2">
              Sampling grid…
            </span>
          )}
        </div>
        <div className="-mx-4 -mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 sm:-mx-5 sm:-mb-5 sm:px-5">
          <p className="label">{layer === "pm2_5" ? "PM2.5 on the AQI scale" : "US AQI"}</p>
          <ul aria-label="AQI categories" className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
            {US_AQI_CATEGORIES.map((c) => (
              <li key={c.level} className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-[1px]" style={{ background: c.color }} aria-hidden />
                {c.short}
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel title="AQI forecast" subtitle="Next 48 hours" className={showPollen ? "lg:order-3 lg:col-span-8" : "lg:order-3 lg:col-span-12"}>
        {view && a && aqiBars ? (
          <>
            <TimeSeriesChart
              ariaLabel="US AQI, next 48 hours"
              times={view.times}
              height={170}
              timeZone={a.timezone}
              yDomain={[0, Math.max(100, ...view.aqi.map((v) => v ?? 0))]}
              thresholds={[{ value: 100, label: "USG threshold", color: USG_COLOR }]}
              series={[aqiBars]}
            />
            <div className="mt-4 border-t border-line pt-3">
              <p className="label mb-1">UV index</p>
              <TimeSeriesChart
                ariaLabel="UV index, next 48 hours"
                times={view.times}
                height={90}
                timeZone={a.timezone}
                yDomain={[0, 11]}
                series={[
                  {
                    key: "uv",
                    label: "UV index",
                    color: "var(--color-series-2)",
                    values: view.idx.map((k) => a.hourly.uv[k] ?? null),
                    kind: "area",
                    format: (v) => v.toFixed(1),
                    axisFormat: (v) => String(Math.round(v)),
                  },
                ]}
              />
            </div>
          </>
        ) : (
          <Skeleton className="h-72" />
        )}
      </Panel>

      {showPollen && (
        <Panel title="Pollen" subtitle="Grains per m³, NAB scale" className="lg:order-4 lg:col-span-4">
          {!a || !view ? (
            <Skeleton className="h-48" />
          ) : (
            <ul aria-label="Pollen by type" className="divide-y divide-line">
              {POLLEN.map((p) => {
                const v = a.hourly[p.key][view.i];
                const lvl = pollenLevel(p.key, v);
                return (
                  <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem] items-center gap-3 py-2 text-[13px] first:pt-0 last:pb-0">
                    <span className="truncate text-ink-2">{p.label}</span>
                    <span className="text-right font-medium text-ink tabular">{v != null ? Math.round(v) : "—"}</span>
                    {lvl ? (
                      <span className="inline-flex items-center gap-1.5 justify-self-start rounded-[4px] border border-line px-1.5 py-px text-[11px] font-medium text-ink-2">
                        <span className="size-1.5 shrink-0 rounded-[1px]" style={{ background: LEVEL_SWATCH[lvl] }} aria-hidden />
                        {sentence(lvl)}
                      </span>
                    ) : (
                      <span aria-hidden />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
