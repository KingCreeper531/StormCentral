"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import type { LatLon } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import {
  accumulate,
  COMPARE_MODELS,
  displayScale,
  ENSEMBLES,
  fetchEnsemble,
  fetchMultiModel,
  hasData,
  METEO_VAR_IDS,
  METEO_VARS,
  plumeStats,
  startIndex,
  type MeteoVar,
} from "@/lib/weather/meteogram";
import { fmtIn } from "@/lib/weather/view";
import { Segmented } from "../ui/segmented";
import { TimeSeriesChart, type SeriesDef } from "./time-series";

type View = "models" | "ensemble";
const DAYS = [2, 5, 10, 15] as const;
type Days = (typeof DAYS)[number];
/** Hours of the recent past shown before now. */
const PAST_H = 12;
const ALL_MODELS = COMPARE_MODELS.map((m) => m.id);
/** Written out in full so the CSS keeps every one (it drops variables it never sees named). */
const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
] as const;
/** A model keeps its colour whatever else is shown (the order of COMPARE_MODELS). */
const colorOf = (id: string) => SERIES[COMPARE_MODELS.findIndex((m) => m.id === id)] ?? SERIES[0];
const PLUME = SERIES[0];

const pointKey = (p: LatLon) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

/** Indices of `time` inside [now − 12 h, now + days]. */
function windowOf(time: readonly number[], now: number, days: number): [number, number] {
  const from = now - PAST_H * 3_600_000;
  const to = now + days * 86_400_000;
  let a = time.findIndex((t) => t >= from);
  if (a < 0) a = 0;
  let b = time.length;
  while (b > a && time[b - 1]! > to) b--;
  return [a, b];
}

/**
 * A meteogram for one spot: every model's forecast side by side (multi-model),
 * or one ensemble's runs as a plume with its average and middle 80 %. Values
 * follow the person's units; the table under it lists the same numbers.
 */
export function Meteogram({
  point,
  models,
  onModels,
  ensemble,
  onEnsemble,
  timeZone,
}: {
  point: LatLon;
  models: readonly string[];
  onModels: (ids: string[]) => void;
  ensemble: string;
  onEnsemble: (id: string) => void;
  timeZone?: string;
}) {
  const t = useT();
  const f = useFormat();
  const now = useNow(5 * 60_000);
  const [view, setView] = useState<View>("models");
  const [v, setV] = useState<MeteoVar>("temp");
  const [days, setDays] = useState<Days>(5);
  const key = pointKey(point);
  const scale = useMemo(() => displayScale(v, f.units), [v, f.units]);

  // Every model in one request, so showing or hiding one is instant.
  const multi = useQuery({
    queryKey: ["meteogram", key],
    queryFn: ({ signal }) => fetchMultiModel(point, ALL_MODELS, signal),
    staleTime: 15 * 60_000,
    retry: 1,
    enabled: view === "models",
  });
  const ens = useQuery({
    queryKey: ["meteogram-ens", key, ensemble, v],
    queryFn: ({ signal }) => fetchEnsemble(point, ensemble, v, signal),
    staleTime: 30 * 60_000,
    retry: 1,
    enabled: view === "ensemble",
  });
  const ensInfo = ENSEMBLES.find((e) => e.id === ensemble) ?? ENSEMBLES[0]!;

  const chart = useMemo(() => {
    /** Converted to the person's units, precipitation as the total from now. */
    const prep = (s: readonly (number | null)[], start: number) => (v === "precip" ? accumulate([...s], start) : s).map((x) => (x == null ? null : scale.convert(x)));
    if (view === "models") {
      const d = multi.data;
      if (!d) return null;
      const start = startIndex(d.time, now);
      const [a, b] = windowOf(d.time, now, days);
      const times = d.time.slice(a, b);
      const available = new Set(ALL_MODELS.filter((id) => hasData(d.values[v][id]?.slice(a, b))));
      const series: SeriesDef[] = COMPARE_MODELS.filter((m) => models.includes(m.id) && available.has(m.id)).map((m) => ({
        key: m.id,
        label: m.label,
        color: colorOf(m.id),
        values: prep(d.values[v][m.id]!, start).slice(a, b),
        format: scale.format,
        axisFormat: scale.axis,
      }));
      return { times, series, available };
    }
    const d = ens.data;
    if (!d || !d.members.length) return null;
    const start = startIndex(d.time, now);
    const [a, b] = windowOf(d.time, now, days);
    const times = d.time.slice(a, b);
    const members = d.members.map((m) => prep(m, start).slice(a, b));
    const s = plumeStats(members);
    const series: SeriesDef[] = [
      ...members.map((m, i) => ({ key: `m${i}`, label: "", color: "var(--color-ink-3)", values: m, quiet: true })),
      { key: "band", label: t("Middle 80% of runs"), color: PLUME, kind: "range" as const, lower: s.p10, values: s.p90, format: scale.format, axisFormat: scale.axis },
      { key: "mean", label: t("Average of {n} runs", { n: members.length }), color: PLUME, values: s.mean, format: scale.format, axisFormat: scale.axis },
    ];
    return { times, series, available: null };
  }, [view, multi.data, ens.data, v, days, now, models, scale, t]);

  const q = view === "models" ? multi : ens;
  const toggle = (id: string) => onModels(models.includes(id) ? models.filter((m) => m !== id) : [...models, id]);
  const fmtRow = useMemo(() => fmtIn(timeZone, { weekday: "short", hour: "numeric" }, t.locale), [timeZone, t]);
  // The table: every 6 hours of what the chart shows.
  const tableRows = chart ? chart.times.map((at, i) => ({ at, i })).filter(({ at }) => new Date(at).getUTCHours() % 6 === 0) : [];
  const tableCols = chart ? chart.series.filter((s) => !s.quiet) : [];

  return (
    <div className="space-y-2.5">
      <Segmented<View>
        ariaLabel={t("Meteogram view")}
        size="sm"
        stretch
        value={view}
        onChange={setView}
        options={[
          { value: "models", label: t("Models") },
          { value: "ensemble", label: t("Ensemble") },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("What to plot")}
          value={v}
          onChange={(e) => setV(e.target.value as MeteoVar)}
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 text-[12px] text-ink outline-none focus:border-line-strong"
        >
          {METEO_VAR_IDS.map((id) => (
            <option key={id} value={id}>
              {t(METEO_VARS[id].label)}
            </option>
          ))}
        </select>
        <Segmented<Days>
          ariaLabel={t("Days to show")}
          size="sm"
          value={days}
          onChange={setDays}
          options={DAYS.map((d) => ({ value: d, label: t("{n} d", { n: d }), title: t("{n} days", { n: d }) }))}
        />
      </div>

      {view === "models" ? (
        // The legend: tap a model to show or hide it. Greyed out where it has nothing for this spot and variable.
        <ul className="flex flex-wrap gap-1.5" aria-label={t("Models")}>
          {COMPARE_MODELS.map((m) => {
            const on = models.includes(m.id);
            const missing = chart?.available ? !chart.available.has(m.id) : false;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={missing}
                  onClick={() => toggle(m.id)}
                  title={missing ? t("No {what} from this model here", { what: t(METEO_VARS[v].label).toLowerCase() }) : t(m.note)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors",
                    on && !missing ? "border-line-strong bg-surface-2 text-ink" : "border-line text-ink-3",
                    missing ? "cursor-not-allowed opacity-45" : "hover:text-ink",
                  )}
                >
                  <svg width={12} height={8} aria-hidden className="shrink-0">
                    <line x1={1} x2={11} y1={4} y2={4} stroke={colorOf(m.id)} strokeWidth={2} strokeLinecap="round" opacity={on && !missing ? 1 : 0.35} />
                  </svg>
                  {m.label}
                  {m.ai && <span className="rounded-[3px] bg-surface-3 px-1 text-[9px] font-semibold tracking-wide text-ink-2">{t("AI")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="space-y-1">
          <select
            aria-label={t("Ensemble")}
            value={ensInfo.id}
            onChange={(e) => onEnsemble(e.target.value)}
            className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 text-[12px] text-ink outline-none focus:border-line-strong"
          >
            {ENSEMBLES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
                {e.ai ? ` · ${t("AI")}` : ""} · {t("{n} runs", { n: e.members })}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-ink-3">{t(ensInfo.note)}</p>
        </div>
      )}

      {q.isLoading ? (
        <p className="py-6 text-center text-[12px] text-ink-3">{t("Loading the models…")}</p>
      ) : q.isError ? (
        <p className="py-6 text-center text-[12px] text-caution">{t("Couldn't load the models. Try again in a moment.")}</p>
      ) : !chart || !chart.series.length ? (
        <p className="py-6 text-center text-[12px] text-ink-3">
          {view === "ensemble"
            ? t("{ensemble} doesn't forecast {what}. Pick another ensemble.", { ensemble: ensInfo.label, what: t(METEO_VARS[v].label).toLowerCase() })
            : t("Pick a model above to plot it.")}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-ink-3">
            {t(METEO_VARS[v].caption ?? METEO_VARS[v].label)} · {scale.unit}
          </p>
          <TimeSeriesChart
            times={chart.times}
            series={chart.series}
            height={220}
            now={now}
            timeZone={timeZone}
            legend={view === "ensemble"}
            yDomain={v === "precip" || v === "cape" || v === "gust" ? [0, null] : undefined}
            ariaLabel={t("{what}, {view}", { what: t(METEO_VARS[v].label), view: t(view === "models" ? "Models" : "Ensemble") })}
          />
          <details className="text-[11px]">
            <summary className="cursor-pointer text-ink-3 hover:text-ink">{t("Table")}</summary>
            <div className="mt-1.5 max-h-56 overflow-auto rounded-[4px] border border-line">
              <table className="w-full text-right tabular-nums">
                <thead className="sticky top-0 bg-surface-2 text-ink-3">
                  <tr>
                    <th className="px-1.5 py-1 text-left font-medium">{t("Time")}</th>
                    {tableCols.map((s) => (
                      <th key={s.key} className="px-1.5 py-1 font-medium whitespace-nowrap">
                        {s.kind === "range" ? t("10–90%") : s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-ink">
                  {tableRows.map(({ at, i }) => (
                    <tr key={at} className="border-t border-line">
                      <td className="px-1.5 py-0.5 text-left whitespace-nowrap text-ink-3">{fmtRow.format(at)}</td>
                      {tableCols.map((s) => {
                        const hi = s.values[i];
                        const lo = s.kind === "range" ? s.lower?.[i] : null;
                        return (
                          <td key={s.key} className="px-1.5 py-0.5 whitespace-nowrap">
                            {hi == null ? "—" : lo != null ? `${scale.axis(lo)}–${scale.axis(hi)}` : scale.format(hi)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <p className="text-[10px] text-ink-3">{t("Model data: Open-Meteo (CC BY 4.0).")}</p>
    </div>
  );
}
