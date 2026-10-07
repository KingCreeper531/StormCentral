"use client";

import { useAirQuality, useForecast } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { NearbyReports } from "../community/nearby-reports";
import { CurrentHero } from "../daily/current-hero";
import { DailyOutlook } from "../daily/daily-outlook";
import { ConditionsPanel, SunMoonPanel } from "../daily/details-grid";
import { HourlyPanel } from "../daily/hourly-panel";
import { NowcastCard } from "../daily/nowcast-card";
import { RadarPreview } from "../daily/radar-preview";
import { ErrorNote, Skeleton } from "../ui/misc";

/** Conditions + 10-day + sun and moon (see below). */
const DETAILS_GRID = "grid min-w-0 grid-cols-1 gap-4 lg:col-span-12 lg:grid-cols-12 lg:grid-rows-[auto_minmax(0,1fr)]";

/**
 * Phones: one column in reading order (hero, nowcast, hourly, radar,
 * conditions, 10-day, sun and moon, reports). Desktop: a 7/5 split where the
 * 10-day list spans the conditions and sun-and-moon rows.
 *
 * Conditions, 10-day and sun-and-moon share a nested two-row grid
 * (`auto` + `1fr`) so that, whichever column is taller, the slack lands in the
 * sun-and-moon row (which centres its content) or is shared across the 10-day
 * rows, never as an empty block under either column.
 */
export function DailyMode() {
  const forecast = useForecast();
  const air = useAirQuality();
  const now = useNow(60_000);
  const f = forecast.data;

  if (forecast.error && !f) return <ErrorNote error={forecast.error} what="the forecast" />;
  if (!f)
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-busy="true">
        <Skeleton className="h-48 lg:col-span-7" />
        <Skeleton className="h-44 lg:col-span-5 lg:self-end" />
        <Skeleton className="h-96 lg:col-span-7" />
        <Skeleton className="h-80 lg:col-span-5 lg:h-auto" />
        <div className={DETAILS_GRID}>
          <Skeleton className="h-64 lg:col-span-7" />
          <Skeleton className="h-[30rem] lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:h-auto" />
          <Skeleton className="h-52 lg:col-span-7" />
        </div>
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <CurrentHero f={f} now={now} className="lg:col-span-7" />
      <NowcastCard f={f} now={now} className="lg:col-span-5 lg:self-end" />
      <HourlyPanel f={f} now={now} className="lg:col-span-7" />
      <RadarPreview now={now} timeZone={f.timezone} className="lg:col-span-5" />
      <div className={DETAILS_GRID}>
        <ConditionsPanel f={f} air={air.data} now={now} className="lg:col-span-7" />
        <DailyOutlook f={f} now={now} className="lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1" />
        <SunMoonPanel f={f} now={now} className="lg:col-span-7" />
      </div>
      <div className="min-w-0 lg:col-span-12">
        <NearbyReports now={now} />
      </div>
    </div>
  );
}
