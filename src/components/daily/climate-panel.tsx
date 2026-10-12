"use client";

import { useClimate, useRecentPrecip } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import type { Forecast } from "@/lib/api/open-meteo";
import { isoDateIn, normalPrecipOver, normalPrecipToDate, slotOf, type ClimateTable } from "@/lib/climate";
import { rainTotals } from "@/lib/rainfall";
import { cn } from "@/lib/utils";
import { fmtIn, todayIndex } from "@/lib/weather/view";
import { Skeleton, Stat } from "../ui/misc";
import { Panel } from "../ui/panel";

/** A temperature difference (°C) in the display unit: "+8°", "−3°", "±0°". */
function delta(dC: number, unit: "F" | "C") {
  const v = Math.round(unit === "F" ? (dC * 9) / 5 : dC);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}°`;
}

function headline(diffC: number | null, unit: "F" | "C") {
  if (diffC == null) return null;
  const d = Math.abs(unit === "F" ? (diffC * 9) / 5 : diffC);
  if (d < 2) return "Today is close to normal for the date";
  const word = diffC > 0 ? "warmer" : "cooler";
  return `Today is ${Math.round(d)}° ${word} than normal${d >= (unit === "F" ? 15 : 8) ? ", well out of the ordinary" : ""}`;
}

/** Departure of each day's forecast high from normal, as up/down bars. */
function DepartureStrip({ f, c, now, unit }: { f: Forecast; c: ClimateTable; now: number; unit: "F" | "C" }) {
  const di = todayIndex(f, now);
  const dayFmt = fmtIn(f.timezone, { weekday: "short" });
  const days = [];
  for (let i = di; i < Math.min(f.daily.time.length, di + 7); i++) {
    const t = f.daily.time[i]! * 1000;
    const hi = f.daily.tMax[i];
    const normal = c.hi[slotOf(isoDateIn(t + 12 * 3_600_000, f.timezone))];
    days.push({ t, diff: hi != null && normal != null ? hi - normal : null, today: i === di });
  }
  const span = Math.max(4, ...days.map((d) => Math.abs(d.diff ?? 0)));
  return (
    <ol className="mt-4 grid grid-cols-7 gap-1 border-t border-line pt-3" aria-label="Forecast highs compared with normal, next 7 days">
      {days.map((d) => {
        const h = d.diff == null ? 0 : (Math.abs(d.diff) / span) * 100;
        return (
          <li key={d.t} className="flex min-w-0 flex-col items-center gap-1">
            <span className={cn("text-[11px] tabular", d.today ? "font-semibold text-ink" : "text-ink-3")}>{d.today ? "Today" : dayFmt.format(d.t)}</span>
            {/* Upper half: warmer than normal; lower half: cooler. */}
            <div className="relative h-14 w-3" aria-hidden>
              <span className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
              {d.diff != null && (
                <span
                  className={cn("absolute inset-x-0 rounded-[2px]", d.diff >= 0 ? "bottom-1/2 bg-nogo" : "top-1/2 bg-accent")}
                  style={{ height: `${Math.max(4, h / 2)}%` }}
                />
              )}
            </div>
            <span className="text-[11px] text-ink-2 tabular">{d.diff == null ? "—" : delta(d.diff, unit)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * How today compares with the climate: departure from normal, the records
 * for the date, this month's rain against normal and the week ahead.
 */
export function ClimatePanel({ f, now, className }: { f: Forecast; now: number; className?: string }) {
  const fmt = useFormat();
  const unit = fmt.units.temp;
  const q = useClimate();
  const recent = useRecentPrecip();
  const c = q.data;
  if (q.isError && !c) return null;
  if (!c)
    return (
      <Panel title="Compared with normal" aria-busy="true" className={className}>
        <Skeleton className="h-5 w-3/4" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      </Panel>
    );

  const di = todayIndex(f, now);
  const iso = isoDateIn(now, f.timezone);
  const s = slotOf(iso);
  const hi = f.daily.tMax[di] ?? null;
  const lo = f.daily.tMin[di] ?? null;
  const nHi = c.hi[s] ?? null;
  const nLo = c.lo[s] ?? null;
  const rHi = c.recHi[s] ?? null;
  const rLo = c.recLo[s] ?? null;
  const diff = hi != null && nHi != null ? hi - nHi : null;
  const nearHi = hi != null && rHi != null && hi >= rHi - 1;
  const nearLo = lo != null && rLo != null && lo <= rLo + 1;
  const dateLabel = fmtIn(f.timezone, { month: "long", day: "numeric" }).format(now);

  const totals = recent.data ? rainTotals(recent.data, now) : null;
  const normalMonth = normalPrecipToDate(c, iso);
  const normal30 = normalPrecipOver(c, iso, 30);
  const pct = (v: number | null | undefined, n: number | null | undefined) => (v != null && n != null && n > 0.5 ? Math.round((v / n) * 100) : null);
  const monthPct = pct(totals?.monthToDate, normalMonth?.toDate);
  const d30Pct = pct(totals?.last30d, normal30);
  const monthName = fmtIn(f.timezone, { month: "long" }).format(now);

  return (
    <Panel title="Compared with normal" subtitle={`Climate for ${dateLabel}`} className={className}>
      <p className="text-lg font-medium text-ink">{headline(diff, unit) ?? "Normals unavailable for today"}</p>
      {(nearHi || nearLo) && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-[4px] border border-caution/40 bg-caution/10 px-2 py-0.5 text-xs font-medium text-ink">
          <span aria-hidden className="size-2 rounded-[2px] bg-caution" />
          {nearHi ? (hi! >= rHi! ? "Forecast high beats the record for the date" : "Forecast high is near the record") : lo! <= rLo! ? "Forecast low beats the record for the date" : "Forecast low is near the record"}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Stat label="High" value={fmt.temp(hi)} sub={`Normal ${fmt.temp(nHi)}`} />
        <Stat label="Low" value={fmt.temp(lo)} sub={`Normal ${fmt.temp(nLo)}`} />
        <Stat label="Record high" value={fmt.temp(rHi)} sub={c.recHiYear[s] ? `in ${c.recHiYear[s]}` : undefined} />
        <Stat label="Record low" value={fmt.temp(rLo)} sub={c.recLoYear[s] ? `in ${c.recLoYear[s]}` : undefined} />
      </div>

      {totals && normalMonth && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3">
          <div className="min-w-0">
            <dt className="label">Rain in {monthName} so far</dt>
            <dd className="mt-0.5 text-[15px] font-medium text-ink tabular">
              {fmt.precip(totals.monthToDate)}
              {monthPct != null && <span className="ml-1.5 text-xs font-normal text-ink-3">{monthPct}% of normal</span>}
            </dd>
            <dd className="text-xs text-ink-3 tabular">
              Normal {fmt.precip(normalMonth.toDate)} to date, {fmt.precip(normalMonth.month)} for the month
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label">Last 30 days</dt>
            <dd className="mt-0.5 text-[15px] font-medium text-ink tabular">
              {fmt.precip(totals.last30d)}
              {d30Pct != null && <span className="ml-1.5 text-xs font-normal text-ink-3">{d30Pct}% of normal</span>}
            </dd>
            <dd className="text-xs text-ink-3 tabular">Normal {fmt.precip(normal30)}</dd>
          </div>
        </dl>
      )}

      <DepartureStrip f={f} c={c} now={now} unit={unit} />

      <p className="mt-3 text-xs text-ink-3">
        Official {c.normalYears[0]}–{c.normalYears[1]} normals and records since {c.recordYears[0]} for {c.station}
        {c.distanceKm >= 15 ? ` (${fmt.distanceKm(c.distanceKm)} away)` : ""}, from NOAA ACIS.
      </p>
    </Panel>
  );
}
