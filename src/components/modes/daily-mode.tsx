"use client";

import { useAirQuality, useForecast } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { NearbyReports } from "../community/nearby-reports";
import { ClimatePanel } from "../daily/climate-panel";
import { CurrentHero } from "../daily/current-hero";
import { DailyOutlook } from "../daily/daily-outlook";
import { FireSmokePanel } from "../daily/fire-smoke-panel";
import { ForecasterNotesPanel } from "../daily/forecaster-notes-panel";
import { GoogleForecastPanel } from "../daily/google-forecast-panel";
import { ConditionsPanel, SunMoonPanel } from "../daily/details-grid";
import { HourlyPanel } from "../daily/hourly-panel";
import { NowcastCard } from "../daily/nowcast-card";
import { RadarPreview } from "../daily/radar-preview";
import { RainfallPanel } from "../daily/rainfall-panel";
import { SevereRiskPanel } from "../daily/severe-risk-panel";
import { ErrorNote, Skeleton } from "../ui/misc";
import { PanelBoundary } from "../ui/panel-boundary";

/** Conditions + 10-day + sun and moon (see below). */
const DETAILS_GRID = "grid min-w-0 grid-cols-1 gap-4 lg:col-span-12 lg:grid-cols-12 lg:grid-rows-[auto_minmax(0,1fr)]";

/**
 * Phones: one column in reading order (hero, nowcast, hourly, radar,
 * conditions, 10-day, sun and moon, forecaster notes, climate, rain and
 * flooding, fire and smoke, reports). Desktop: a 7/5 split where the
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

  // A panel that fails hides itself; the rest of the page keeps working. Each retries on a new place.
  const place = `${f.lat},${f.lon}`;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <PanelBoundary name="hero" resetKey={place}>
        <CurrentHero f={f} now={now} className="lg:col-span-7" />
      </PanelBoundary>
      <PanelBoundary name="nowcast" resetKey={place}>
        <NowcastCard f={f} now={now} className="lg:col-span-5 lg:self-end" />
      </PanelBoundary>
      <PanelBoundary name="hourly" resetKey={place}>
        <HourlyPanel f={f} now={now} className="lg:col-span-7" />
      </PanelBoundary>
      <PanelBoundary name="radar preview" resetKey={place}>
        <RadarPreview now={now} timeZone={f.timezone} className="lg:col-span-5" />
      </PanelBoundary>
      {/* Only renders inside an SPC thunderstorm area. */}
      <PanelBoundary name="severe outlook" resetKey={place}>
        <SevereRiskPanel timeZone={f.timezone} className="lg:col-span-12" />
      </PanelBoundary>
      <PanelBoundary name="Google forecast" resetKey={place}>
        <GoogleForecastPanel f={f} now={now} className="lg:col-span-12" />
      </PanelBoundary>
      <div className={DETAILS_GRID}>
        <PanelBoundary name="conditions" resetKey={place}>
          <ConditionsPanel f={f} air={air.data} now={now} className="lg:col-span-7" />
        </PanelBoundary>
        <PanelBoundary name="10-day" resetKey={place}>
          <DailyOutlook f={f} now={now} className="lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1" />
        </PanelBoundary>
        <PanelBoundary name="sun and moon" resetKey={place}>
          <SunMoonPanel f={f} now={now} className="lg:col-span-7" />
        </PanelBoundary>
      </div>
      {/* US only (NWS); renders nothing elsewhere, and climate moves up beside rainfall. */}
      <PanelBoundary name="forecaster notes" resetKey={place}>
        <ForecasterNotesPanel now={now} className="lg:col-span-7" />
      </PanelBoundary>
      <PanelBoundary name="climate" resetKey={place}>
        <ClimatePanel f={f} now={now} className="lg:col-span-5" />
      </PanelBoundary>
      <PanelBoundary name="rainfall" resetKey={place}>
        <RainfallPanel f={f} now={now} className="lg:col-span-7" />
      </PanelBoundary>
      <PanelBoundary name="fire and smoke" resetKey={place}>
        <FireSmokePanel f={f} air={air.data} now={now} className="lg:col-span-5" />
      </PanelBoundary>
      {COMMUNITY_ENABLED && (
        <div className="min-w-0 lg:col-span-12">
          <PanelBoundary name="nearby reports" resetKey={place}>
            <NearbyReports now={now} />
          </PanelBoundary>
        </div>
      )}
    </div>
  );
}
