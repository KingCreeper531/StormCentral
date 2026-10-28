"use client";

import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import { SNOW_THRESHOLDS, snowThresholdLabel } from "@/lib/radar/snow";
import type { RadarSettings } from "@/store/app-store";
import { Segmented } from "../ui/segmented";
import { SnowLegend } from "./snow-legend";

/** Layer menu: the snow overlay (off, WPC's Day 1–3 chance of snow, NOHRSC's depth now), its threshold and key. */
export function SnowField({ settings, onChange }: { settings: RadarSettings; onChange: (r: Partial<RadarSettings>) => void }) {
  const t = useT();
  const { units } = useFormat();
  const forecast = settings.snow !== "off" && settings.snow !== "depth";

  return (
    <div className="min-w-0">
      <p className="label mb-1.5">{t("Snow")}</p>
      <Segmented
        ariaLabel={t("Snow map")}
        size="sm"
        stretch
        value={settings.snow}
        onChange={(snow) => onChange({ snow })}
        options={[
          { value: "off", label: t("Off") },
          { value: "day1", label: t("Day 1"), title: t("Snowfall forecast, the next 24 hours") },
          { value: "day2", label: t("Day 2"), title: t("Snowfall forecast, 24 to 48 hours ahead") },
          { value: "day3", label: t("Day 3"), title: t("Snowfall forecast, 48 to 72 hours ahead") },
          { value: "depth", label: t("Depth"), title: t("Snow depth now") },
        ]}
      />
      {forecast && (
        <Segmented
          ariaLabel={t("Snowfall amount")}
          size="sm"
          stretch
          className="mt-2"
          value={settings.snowThreshold}
          onChange={(snowThreshold) => onChange({ snowThreshold })}
          options={SNOW_THRESHOLDS.map((n) => ({ value: n, label: `≥ ${snowThresholdLabel(n, units.precip === "mm")}` }))}
        />
      )}
      {settings.snow !== "off" && <SnowLegend map={settings.snow} threshold={settings.snowThreshold} variant="plain" className="mt-2" />}
      {forecast && <p className="label mt-1.5">{t("The Weather Prediction Center's chance of at least that much snow in each 24-hour day. Under the radar, so storms stay on top.")}</p>}
    </div>
  );
}
