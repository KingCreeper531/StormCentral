"use client";

import { useAirQuality, useForecast } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { NearbyReports } from "../community/nearby-reports";
import { CurrentHero } from "../daily/current-hero";
import { DailyOutlook } from "../daily/daily-outlook";
import { DetailsGrid } from "../daily/details-grid";
import { HourlyPanel } from "../daily/hourly-panel";
import { NowcastCard } from "../daily/nowcast-card";
import { RadarPreview } from "../daily/radar-preview";
import { ErrorNote, Skeleton } from "../ui/misc";

export function DailyMode() {
  const forecast = useForecast();
  const air = useAirQuality();
  const now = useNow(60_000);
  const f = forecast.data;

  if (forecast.error && !f) return <ErrorNote error={forecast.error} what="the forecast" />;
  if (!f)
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
        <Skeleton className="h-56 lg:col-span-3" />
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <CurrentHero f={f} now={now} />
      </div>
      <div className="flex flex-col gap-4 lg:col-span-5 lg:pt-6">
        <NowcastCard f={f} now={now} />
      </div>
      <div className="lg:col-span-7">
        <HourlyPanel f={f} now={now} />
      </div>
      <div className="lg:col-span-5">
        <RadarPreview now={now} timeZone={f.timezone} />
      </div>
      <div className="lg:col-span-7">
        <DetailsGrid f={f} air={air.data} now={now} />
      </div>
      <div className="lg:col-span-5">
        <DailyOutlook f={f} now={now} />
      </div>
      <div className="lg:col-span-12">
        <NearbyReports now={now} />
      </div>
    </div>
  );
}
