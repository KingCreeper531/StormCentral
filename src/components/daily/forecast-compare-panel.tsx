"use client";

import { Settings2 } from "lucide-react";
import Link from "next/link";
import { useFormat } from "@/hooks/use-format";
import type { Forecast } from "@/lib/api/open-meteo";
import { compareSource, precipBetween } from "@/lib/compare-sources";
import type { GoogleWeather } from "@/lib/google-weather";
import { cn } from "@/lib/utils";
import { fmtIn } from "@/lib/weather/view";
import { iconName } from "@/lib/weather/wmo";
import { useAppStore } from "@/store/app-store";
import { buttonClass } from "../ui/button";
import { Skeleton } from "../ui/misc";
import { Panel } from "../ui/panel";
import { WeatherIcon } from "../ui/weather-icon";
import { useCompareSeries, type CompareResult } from "./use-compare";

const DOT = ["var(--color-series-1)", "var(--color-series-2)"] as const;

/** Why a source has nothing to show, in a sentence. */
function unavailable(r: CompareResult | undefined, label: string, failed: boolean): string | null {
  if (failed) return `Couldn't load ${label} right now.`;
  if (!r) return null;
  if (r.kind === "no-key") return "Add your own Google Weather API key in Settings to compare with Google.";
  if (r.kind === "key-error") return `Google: ${r.message}`;
  if (r.kind === "none") return `${label} has no forecast for this location.`;
  return null;
}

function Chip({ i, label }: { i: 0 | 1; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: DOT[i] }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * Two forecasts side by side for the next week, chosen in Settings: the app's
 * own, Google (with the person's key), ECMWF, GFS, national and AI models.
 */
export function ForecastComparePanel({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const pair = useAppStore((s) => s.compare);
  const A = compareSource(pair.a);
  const B = compareSource(pair.b);
  const qa = useCompareSeries(pair.a, f);
  const qb = useCompareSeries(pair.b, f);
  const a = qa.data?.kind === "ok" ? qa.data.data : null;
  const b = qb.data?.kind === "ok" ? qb.data.data : null;
  const loading = (!qa.data && !qa.isError) || (!qb.data && !qb.isError);

  const dayFmt = fmtIn("UTC", { weekday: "short" });
  const byDate = (s: GoogleWeather | null) => new Map((s?.days ?? []).map((d) => [d.date, d]));
  const da = byDate(a);
  const db = byDate(b);
  const dates = [...new Set([...(a?.days ?? []), ...(b?.days ?? [])].map((d) => d.date))].sort().slice(0, 7);

  // The biggest disagreement on a high, for the summary line.
  let worst: { date: string; diff: number } | null = null;
  for (const date of dates) {
    const x = da.get(date)?.hiC;
    const y = db.get(date)?.hiC;
    if (x == null || y == null) continue;
    if (!worst || Math.abs(y - x) > Math.abs(worst.diff)) worst = { date, diff: y - x };
  }
  const agreeC = fmt.units.temp === "F" ? 1.7 : 2; // about 3 °F / 2 °C
  const summary = !a || !b || !worst
    ? null
    : Math.abs(worst.diff) < agreeC
      ? `They agree on the highs within ${fmt.units.temp === "F" ? "3" : "2"}° all week.`
      : `Biggest difference: ${dates.indexOf(worst.date) === 0 ? "today" : dayFmt.format(Date.parse(`${worst.date}T12:00:00Z`))}, ${B.short} ${fmt.tempDelta(Math.abs(worst.diff)).replace(/^[+−±]/, "")} ${worst.diff > 0 ? "warmer" : "cooler"} than ${A.short}.`;
  const rainA = a ? precipBetween(a, now, now + 24 * 3_600_000) : null;
  const rainB = b ? precipBetween(b, now, now + 24 * 3_600_000) : null;
  const notes = [unavailable(qa.data, A.label, qa.isError && !qa.data), unavailable(qb.data, B.label, qb.isError && !qb.data)].filter(Boolean);

  return (
    <Panel
      title="Forecast comparison"
      subtitle={`${A.label} vs ${B.label}`}
      className={className}
      action={
        <Link href="/settings" className={buttonClass("ghost", "sm")} aria-label="Choose the forecasts to compare">
          <Settings2 className="size-3.5" aria-hidden />
          Change
        </Link>
      }
    >
      {loading ? (
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <>
          {summary && <p className="text-sm font-medium text-ink">{summary}</p>}
          {notes.map((n) => (
            <p key={n} className="mt-1 text-xs text-ink-2">
              {n}
            </p>
          ))}

          {dates.length > 0 && (
            <div className="-mx-4 mt-3 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
              <table className="w-full min-w-[22rem] border-collapse text-[13px] tabular">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="py-1.5 pr-2 font-normal">Day</th>
                    <th className="py-1.5 pr-2 font-normal">
                      <Chip i={0} label={A.short} />
                    </th>
                    <th className="py-1.5 pr-2 font-normal">
                      <Chip i={1} label={B.short} />
                    </th>
                    <th className="py-1.5 text-right font-normal">High diff.</th>
                  </tr>
                </thead>
                <tbody>
                  {dates.map((date, i) => {
                    const x = da.get(date);
                    const y = db.get(date);
                    const diff = x?.hiC != null && y?.hiC != null ? y.hiC - x.hiC : null;
                    return (
                      <tr key={date} className="border-t border-line">
                        <td className="py-1.5 pr-2 text-ink-2">{i === 0 ? "Today" : dayFmt.format(Date.parse(`${date}T12:00:00Z`))}</td>
                        {[x, y].map((d, k) => (
                          <td key={k} className="py-1.5 pr-2">
                            {d ? (
                              <span className="inline-flex items-center gap-1.5">
                                <WeatherIcon name={iconName(d.code, true)} size={20} animated={false} />
                                <span className="text-ink">{fmt.temp(d.hiC)}</span>
                                <span className="text-ink-3">/{fmt.temp(d.loC)}</span>
                                {d.precipChance != null ? (
                                  <span className={cn("text-xs", d.precipChance >= 40 ? "text-accent" : "text-ink-3")}>{fmt.percent(d.precipChance)}</span>
                                ) : d.precipMm != null && d.precipMm >= 0.2 ? (
                                  <span className="text-xs text-accent">{fmt.precip(d.precipMm)}</span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-ink-3">—</span>
                            )}
                          </td>
                        ))}
                        <td className={cn("py-1.5 text-right", diff != null && Math.abs(diff) >= agreeC * 1.5 ? "font-medium text-caution" : "text-ink-2")}>
                          {diff == null ? "—" : fmt.tempDelta(diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {(rainA != null || rainB != null) && (
            <p className="mt-3 text-xs text-ink-2">
              Rain in the next 24 hours: {A.short} {fmt.precip(rainA)}, {B.short} {fmt.precip(rainB)}
            </p>
          )}
          <p className="label mt-2">
            {B.note} Pick any two forecasts in Settings.
          </p>
        </>
      )}
    </Panel>
  );
}
