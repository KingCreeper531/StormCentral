"use client";

import { ArrowDown, ArrowUp, EyeOff, LayoutGrid, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useAirQuality, useForecast } from "@/hooks/queries";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import type { AirQuality, Forecast } from "@/lib/api/open-meteo";
import { canMoveDailyItem, dailySections, defaultDailyLayout, moveDailyItem, panelInfo, type DailyColumn, type DailyItem, type DailyPanelId } from "@/lib/daily-layout";
import { useT } from "@/lib/i18n/use-t";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { useAppStore } from "@/store/app-store";
import { NearbyReports } from "../community/nearby-reports";
import { ClimatePanel } from "../daily/climate-panel";
import { CurrentHero } from "../daily/current-hero";
import { DailyOutlook } from "../daily/daily-outlook";
import { ConditionsPanel, SunMoonPanel } from "../daily/details-grid";
import { FireSmokePanel } from "../daily/fire-smoke-panel";
import { ForecastSourceBar } from "../daily/forecast-source-bar";
import { ForecasterNotesPanel } from "../daily/forecaster-notes-panel";
import { HourlyPanel } from "../daily/hourly-panel";
import { IncomingStormsPanel } from "../daily/incoming-storms-panel";
import { NowcastCard } from "../daily/nowcast-card";
import { RadarPreview } from "../daily/radar-preview";
import { RainfallPanel } from "../daily/rainfall-panel";
import { SevereRiskPanel } from "../daily/severe-risk-panel";
import { Button } from "../ui/button";
import { ErrorNote, Skeleton } from "../ui/misc";
import { PanelBoundary } from "../ui/panel-boundary";
import { Segmented } from "../ui/segmented";

interface Ctx {
  f: Forecast;
  air: AirQuality | undefined;
  now: number;
}

/** Every Daily panel by id. Panels size to their column; several render nothing when they don't apply. */
const RENDER: Record<DailyPanelId, (c: Ctx) => React.ReactNode> = {
  storms: () => <IncomingStormsPanel />,
  hero: ({ f, now }) => <CurrentHero f={f} now={now} />,
  nowcast: ({ f, now }) => <NowcastCard f={f} now={now} />,
  hourly: ({ f, now }) => <HourlyPanel f={f} now={now} />,
  radar: ({ f, now }) => <RadarPreview now={now} timeZone={f.timezone} />,
  severe: ({ f }) => <SevereRiskPanel timeZone={f.timezone} />,
  conditions: ({ f, air, now }) => <ConditionsPanel f={f} air={air} now={now} />,
  outlook: ({ f, now }) => <DailyOutlook f={f} now={now} />,
  sunmoon: ({ f, now }) => <SunMoonPanel f={f} now={now} />,
  notes: ({ now }) => <ForecasterNotesPanel now={now} />,
  climate: ({ f, now }) => <ClimatePanel f={f} now={now} />,
  rainfall: ({ f, now }) => <RainfallPanel f={f} now={now} />,
  fire: ({ f, air, now }) => <FireSmokePanel f={f} air={air} now={now} />,
  reports: ({ now }) => <NearbyReports now={now} />,
};

/** Panels this build can show at all (the spotter network is off in some builds). */
const available = (item: DailyItem) => item.id !== "reports" || COMMUNITY_ENABLED;

const COLUMN_OPTIONS: { value: DailyColumn; label: string }[] = [
  { value: "main", label: "Left" },
  { value: "side", label: "Right" },
  { value: "full", label: "Full" },
];

/** Edit-mode chrome around one panel: its name, move, placement and hide. */
function EditFrame({ item, columns, children }: { item: DailyItem; columns: boolean; children: React.ReactNode }) {
  const t = useT();
  const layout = useAppStore((s) => s.dailyLayout);
  const setLayout = useAppStore((s) => s.setDailyLayout);
  const info = panelInfo(item.id);
  const panel = t(info.label);
  const patch = (p: Partial<DailyItem>) => setLayout(layout.map((x) => (x.id === item.id ? { ...x, ...p } : x)));
  return (
    <div className="min-w-0 rounded-[calc(var(--radius-panel,10px)+4px)] border-2 border-dashed border-accent/50 p-1">
      <div className="flex flex-wrap items-center gap-1.5 px-1.5 pt-0.5 pb-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {panel}
          {"hint" in info && <span className="font-normal text-ink-3"> · {t(info.hint)}</span>}
        </span>
        <Button size="sm" variant="ghost" aria-label={t("Move {panel} up", { panel })} disabled={!canMoveDailyItem(layout, item.id, -1, columns)} onClick={() => setLayout(moveDailyItem(layout, item.id, -1, columns))}>
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button size="sm" variant="ghost" aria-label={t("Move {panel} down", { panel })} disabled={!canMoveDailyItem(layout, item.id, 1, columns)} onClick={() => setLayout(moveDailyItem(layout, item.id, 1, columns))}>
          <ArrowDown className="size-4" aria-hidden />
        </Button>
        {/* Placement only matters on wide screens. */}
        <Segmented
          className="hidden lg:inline-flex"
          size="sm"
          ariaLabel={t("Where {panel} sits", { panel })}
          value={item.col}
          onChange={(col) => patch({ col })}
          options={COLUMN_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
        />
        <Button size="sm" variant="ghost" aria-label={t("Hide {panel}", { panel })} onClick={() => patch({ hidden: true })}>
          <EyeOff className="size-4" aria-hidden />
          <span className="max-sm:sr-only">{t("Hide")}</span>
        </Button>
      </div>
      {/* The panel itself, untouchable while arranging. */}
      <div inert className="pointer-events-none select-none">
        {children}
      </div>
    </div>
  );
}

/**
 * Conditions, forecasts and details as panels people can reorder, place in
 * the left or right column (or full width) on wide screens, hide and bring
 * back. Phones show the visible panels in order, one column.
 */
export function DailyMode() {
  const t = useT();
  const forecast = useForecast();
  const air = useAirQuality();
  const now = useNow(60_000);
  const layout = useAppStore((s) => s.dailyLayout);
  const setLayout = useAppStore((s) => s.setDailyLayout);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [editing, setEditing] = useState(false);
  const f = forecast.data;

  if (forecast.error && !f) return <ErrorNote error={forecast.error} what="the forecast" />;
  if (!f)
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-busy="true">
        <Skeleton className="h-48 lg:col-span-7" />
        <Skeleton className="h-44 lg:col-span-5 lg:self-end" />
        <Skeleton className="h-96 lg:col-span-7" />
        <Skeleton className="h-80 lg:col-span-5 lg:h-auto" />
      </div>
    );

  const ctx: Ctx = { f, air: air.data, now };
  const usable = layout.filter(available);
  const visible = usable.filter((x) => !x.hidden);
  const hidden = usable.filter((x) => x.hidden);
  // A panel that fails hides itself; the rest keeps working. Each retries on a new place.
  const place = `${f.lat},${f.lon}`;

  const panel = (item: DailyItem) => {
    const body = (
      <PanelBoundary name={panelInfo(item.id).label} resetKey={place}>
        {RENDER[item.id](ctx)}
      </PanelBoundary>
    );
    if (!editing) return <div key={item.id} className="min-w-0 empty:hidden">{body}</div>;
    return (
      <EditFrame key={item.id} item={item} columns={wide}>
        {body}
      </EditFrame>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <ForecastSourceBar f={f} />
      {editing && (
        <div className="surface sticky top-[calc(var(--topbar-h)+8px)] z-30 p-3 shadow-lg sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-sm text-ink">
              <span className="font-semibold">{t("Customize Daily.")}</span>{" "}
              <span className="text-ink-2">
                {wide
                  ? t("Move panels with the arrows, choose left, right or full width, or hide the ones you don't need.")
                  : t("Move panels with the arrows or hide the ones you don't need.")}
              </span>
            </p>
            <Button size="sm" variant="ghost" onClick={() => setLayout(defaultDailyLayout())}>
              <RotateCcw className="size-3.5" aria-hidden />
              {t("Reset")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => setEditing(false)}>
              {t("Done")}
            </Button>
          </div>
          {hidden.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
              <span className="label mr-1">{t("Add back")}</span>
              {hidden.map((x) => (
                <Button key={x.id} size="sm" onClick={() => setLayout(layout.map((y) => (y.id === x.id ? { ...y, hidden: false } : y)))}>
                  <Plus className="size-3.5" aria-hidden />
                  {t(panelInfo(x.id).label)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {wide ? (
        dailySections(visible).map((s, i) =>
          s.kind === "full" ? (
            panel(s.item)
          ) : (
            <div key={`split-${i}`} className="grid grid-cols-12 items-start gap-4">
              <div className="col-span-7 flex min-w-0 flex-col gap-4">{s.main.map(panel)}</div>
              <div className="col-span-5 flex min-w-0 flex-col gap-4">{s.side.map(panel)}</div>
            </div>
          ),
        )
      ) : (
        visible.map(panel)
      )}

      {visible.length === 0 && <p className="py-10 text-center text-sm text-ink-3">{t("Every panel is hidden. Add some back above.")}</p>}

      {!editing && (
        <div className="flex justify-center pt-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <LayoutGrid className="size-4" aria-hidden />
            {t("Customize this page")}
          </Button>
        </div>
      )}
    </div>
  );
}
