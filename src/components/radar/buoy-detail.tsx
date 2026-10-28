"use client";

import { ExternalLink, X } from "lucide-react";
import { useFormat } from "@/hooks/use-format";
import { ndbcStationUrl } from "@/lib/feeds/buoys-parse";
import type { Buoy } from "@/lib/feeds/buoys";
import { bearingDeg, compassPoint, haversineKm, type LatLon } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { formatWaveHeight, waveRgb } from "@/lib/marine";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { clockIn } from "@/lib/weather/view";
import { NO_WAVES_COLOR } from "../map/layers/marine-style";
import { buttonClass, IconButton } from "../ui/button";
import { HazardSwatch } from "./alert-list";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-lg leading-6 font-medium break-words text-ink tabular">{children}</dd>
    </div>
  );
}

/** The marker colour of a station: its wave height on the shared scale, grey without one. */
export const buoyColor = (b: Pick<Buoy, "waveHeight">) => (b.waveHeight == null ? NO_WAVES_COLOR : `rgb(${waveRgb(b.waveHeight).join(" ")})`);

/** One NDBC buoy or coastal station picked on the map: its latest waves, wind, temperatures and pressure. */
export function BuoyDetail({
  buoy: b,
  location,
  now,
  timeZone,
  onClose,
  hideTitle = false,
  className,
}: {
  buoy: Buoy;
  location: LatLon;
  now: number;
  timeZone: string | undefined;
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const t = useT();
  const fmt = useFormat();
  const dir = (deg: number) => t(compassPoint(deg));
  const where = t("{distance} {direction} of you", { distance: fmt.distanceKm(haversineKm(location, b)), direction: dir(bearingDeg(location, b)) });
  const sub = `${b.kind === "buoy" ? t("Buoy {id}", { id: b.id }) : t("Station {id}", { id: b.id })} · ${where}`;
  const wind = b.windSpeed == null ? null : b.windDir == null || b.windSpeed === 0 ? fmt.wind(b.windSpeed) : `${fmt.wind(b.windSpeed)} ${dir(b.windDir)}`;

  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {!hideTitle && (
        <div className="flex items-start gap-3">
          <HazardSwatch color={buoyColor(b)} className="mt-2" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base leading-6 font-semibold break-words text-ink">{b.name}</h3>
            <p className="text-xs text-ink-3 tabular">{sub}</p>
          </div>
          {onClose && (
            <IconButton label={t("Close station")} size="sm" onClick={onClose} className="-mt-1 -mr-2">
              <X className="size-4" aria-hidden />
            </IconButton>
          )}
        </div>
      )}
      {hideTitle && <p className="text-xs text-ink-3 tabular">{sub}</p>}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {b.waveHeight != null && <Fact label={t("Wave height")}>{formatWaveHeight(b.waveHeight, fmt.units.height)}</Fact>}
        {b.dominantPeriod != null && <Fact label={t("Dominant period")}>{t("{n} s", { n: b.dominantPeriod })}</Fact>}
        {b.waveDir != null && (
          <Fact label={t("Wave direction")}>
            {t("From {dir}", { dir: dir(b.waveDir) })} <span className="text-sm text-ink-3">{Math.round(b.waveDir)}°</span>
          </Fact>
        )}
        {wind && <Fact label={t("Wind")}>{wind}</Fact>}
        {b.gust != null && <Fact label={t("Gusts")}>{fmt.wind(b.gust)}</Fact>}
        {b.waterTemp != null && <Fact label={t("Water temperature")}>{fmt.temp(b.waterTemp, true)}</Fact>}
        {b.airTemp != null && <Fact label={t("Air temperature")}>{fmt.temp(b.airTemp, true)}</Fact>}
        {b.pressure != null && <Fact label={t("Pressure")}>{fmt.pressure(b.pressure)}</Fact>}
        <div className="col-span-2">
          <Fact label={t("Observed")}>
            {clockIn(timeZone, b.time, t.locale)} <span className="text-sm text-ink-3">{timeAgo(Date.parse(b.time), now, t)}</span>
          </Fact>
        </div>
      </dl>
      {b.waveHeight == null && <p className="text-xs text-ink-3">{t("This station doesn't measure waves.")}</p>}

      <p className="label">{t("Latest observation from NOAA's National Data Buoy Center")}</p>
      <a href={ndbcStationUrl(b.id)} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
        <ExternalLink className="size-4" aria-hidden />
        {t("Station page (NDBC)")}
      </a>
    </div>
  );
}
