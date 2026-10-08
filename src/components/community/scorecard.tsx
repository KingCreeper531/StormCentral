"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getJson } from "@/lib/api/http";
import { CATEGORIES, SEVERITY_LABELS } from "@/lib/community";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import {
  DEFAULT_WINDOW,
  HIT_RULE,
  MIN_SCORED,
  SCORECARD_WINDOWS,
  type CategoryScore,
  type ModelSnapshot,
  type ScorecardMiss,
  type ScorecardSummary,
  type ScorecardWindow,
} from "@/lib/scorecard";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { describeCode } from "@/lib/weather/wmo";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import { Meter } from "../ui/meter";
import { EmptyState, ErrorNote, Skeleton, Stat } from "../ui/misc";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";

/** Hit rates are a single magnitude series: one chart hue, never status colours. */
const RATE_COLOR = "var(--color-series-1)";

/** Chip recipe from DESIGN.md §5: hairline, 4 px corners, 11 px text. Colour only as a swatch. */
const CHIP = "inline-flex items-center gap-1.5 rounded-[4px] border border-line px-1.5 py-px text-[11px] font-medium text-ink-2";
const SEVERITY_SWATCH: (string | null)[] = [null, null, "var(--color-caution)", "var(--color-nogo)"];

const pct = (rate: number | null) => (rate == null ? "—" : `${Math.round(rate * 100)}%`);

function useScorecard(days: ScorecardWindow) {
  return useQuery({
    queryKey: ["scorecard", days],
    queryFn: ({ signal }) => getJson<ScorecardSummary>(`/api/community/scorecard?days=${days}`, { signal }),
    enabled: COMMUNITY_ENABLED,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-1.5 shrink-0 rounded-[1px]" style={{ background: color }} />;
}

function Overall({ data }: { data: ScorecardSummary }) {
  const { overall } = data;
  const withoutData = overall.reports - overall.scored;
  return (
    <Panel title="Overall" subtitle={`Last ${data.days} days`}>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:gap-6">
        <div className="min-w-0">
          <p className="flex items-baseline gap-1">
            <span className="text-5xl font-light tracking-tight text-ink tabular">{overall.hitRate == null ? "—" : Math.round(overall.hitRate * 100)}</span>
            <span className="text-lg text-ink-3">%</span>
          </p>
          <p className="label mt-0.5">Hit rate</p>
          <Meter value={(overall.hitRate ?? 0) * 100} color={RATE_COLOR} ticks={[25, 50, 75]} label="Overall hit rate" className="mt-2" />
        </div>
        <div className="grid grid-cols-3 content-start gap-4">
          <Stat label="Scored" value={overall.scored} />
          <Stat label="Hits" value={overall.hits} />
          <Stat label="Misses" value={overall.scored - overall.hits} />
        </div>
      </div>
      <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs leading-relaxed text-ink-3">
        <p>
          Each report is checked against the forecast model&apos;s conditions at that place when it was posted. It counts as a hit when the model
          showed the reported weather, such as thunderstorms for hail or strong gusts for wind damage.
        </p>
        {(data.unscoredReports > 0 || withoutData > 0) && (
          <p className="tabular">
            {[
              data.unscoredReports > 0 && `${data.unscoredReports} ${data.unscoredReports === 1 ? "observation or sky photo" : "observations and sky photos"} not scored.`,
              withoutData > 0 && `${withoutData} ${withoutData === 1 ? "report has" : "reports have"} no forecast data.`,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}
      </div>
    </Panel>
  );
}

function CategoryRow({ c }: { c: CategoryScore }) {
  const cat = CATEGORIES[c.category];
  const detail = c.reports === 0 ? "No reports" : c.scored === 0 ? "No forecast data" : `${c.hits} of ${c.scored}`;
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink">
          <Swatch color={cat.color} />
          <span className="truncate">{cat.label}</span>
        </span>
        <span className={cn("shrink-0 text-[13px] font-medium tabular", c.hitRate == null ? "text-ink-3" : "text-ink")}>{pct(c.hitRate)}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-4 text-xs text-ink-3">
        <span className="min-w-0 truncate">{HIT_RULE[c.category]}</span>
        <span className="shrink-0 tabular">{detail}</span>
      </div>
      {c.hitRate != null && <Meter value={c.hitRate * 100} color={RATE_COLOR} label={`${cat.label} hit rate`} className="mt-2" />}
    </li>
  );
}

/** What the model showed, in the viewer's units: "Overcast, 18°C, gust 25 km/h". */
function modelText(m: ModelSnapshot, fmt: ReturnType<typeof useFormat>) {
  const parts: string[] = [];
  if (m.code != null) parts.push(describeCode(m.code).label);
  if (m.tempC != null) parts.push(fmt.temp(m.tempC, true));
  if (m.windMs != null) parts.push(`wind ${fmt.wind(m.windMs)}`);
  if (m.gustMs != null) parts.push(`gust ${fmt.wind(m.gustMs)}`);
  if (m.precipMm != null) parts.push(`${fmt.precip(m.precipMm)} precipitation`);
  if (m.precipProb != null) parts.push(`${Math.round(m.precipProb)}% chance of precipitation`);
  return parts.join(", ") || "No details";
}

function MissRow({ m, now, fmt }: { m: ScorecardMiss; now: number; fmt: ReturnType<typeof useFormat> }) {
  const cat = CATEGORIES[m.category];
  const swatch = SEVERITY_SWATCH[m.severity] ?? null;
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink">
            <Swatch color={cat.color} />
            <span className="truncate">{cat.label}</span>
          </span>
          <span className={cn(CHIP, "shrink-0", m.severity >= 3 && "text-ink")}>
            {swatch && <Swatch color={swatch} />}
            {SEVERITY_LABELS[m.severity]}
          </span>
        </span>
        <time dateTime={new Date(m.createdAt).toISOString()} className="shrink-0 text-xs text-ink-3 tabular">
          {timeAgo(m.createdAt, now)}
        </time>
      </div>
      <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-xs whitespace-nowrap text-ink-3">
        <span className="min-w-0 truncate">{m.place || "Unnamed place"}</span>
        <Link href={`/u/${m.username}`} className="shrink-0 text-ink-2 hover:underline">
          @{m.username}
        </Link>
      </p>
      <p className="mt-0.5 text-xs text-ink-2">
        <span className="text-ink-3">Model showed </span>
        {modelText(m.model, fmt)}
      </p>
    </li>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-hidden>
      <Panel>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-12 w-32" />
        <Skeleton className="mt-3 h-1.5 w-full" />
      </Panel>
      <Panel>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2 py-2.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-1.5 w-full" />
          </div>
        ))}
      </Panel>
    </div>
  );
}

/** Forecast vs. reality: hit rates of the forecast model against spotter reports. */
export function Scorecard() {
  const [days, setDays] = useState<ScorecardWindow>(DEFAULT_WINDOW);
  const q = useScorecard(days);
  const now = useNow(60_000);
  const fmt = useFormat();
  const data = q.data;
  const enough = data != null && data.overall.scored >= MIN_SCORED;

  return (
    <div className="space-y-4">
      <Segmented<ScorecardWindow>
        ariaLabel="Time window"
        value={days}
        onChange={setDays}
        stretch
        className="sm:w-72"
        options={SCORECARD_WINDOWS.map((d) => ({ value: d, label: `${d} days` }))}
      />

      {q.isLoading && <LoadingState />}
      {q.error && !data && (
        <Panel>
          <ErrorNote error={q.error} what="the scorecard" />
        </Panel>
      )}

      {data && (
        <div className={cn("space-y-4 transition-opacity", q.isPlaceholderData && "opacity-60")} aria-busy={q.isPlaceholderData}>
          {!enough ? (
            <Panel>
              <EmptyState icon={<BarChart3 className="size-5 text-ink-3" aria-hidden />} title="Not enough reports with forecast data yet">
                <p>
                  The scorecard needs at least {MIN_SCORED} scored reports in the last {data.days} days.
                  {data.days < 90 && " Try a longer window."}
                </p>
              </EmptyState>
            </Panel>
          ) : (
            <>
              <Overall data={data} />

              <Panel title="By report type" subtitle="Share of scored reports where the model showed that weather">
                <ul className="-my-2.5 divide-y divide-line">
                  {data.categories.map((c) => (
                    <CategoryRow key={c.category} c={c} />
                  ))}
                </ul>
              </Panel>

              <Panel title="Recent misses" subtitle="Significant and dangerous reports the model didn't show">
                {data.misses.length ? (
                  <ul className="-my-2.5 divide-y divide-line">
                    {data.misses.map((m) => (
                      <MissRow key={m.id} m={m} now={now} fmt={fmt} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-3">No significant reports were missed in this window.</p>
                )}
              </Panel>
            </>
          )}
        </div>
      )}
    </div>
  );
}
