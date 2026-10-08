"use client";

import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useForecast, useLocalAlerts, useNationalAlerts } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { useUrlSync } from "@/hooks/use-url-sync";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { currentHourIndex } from "@/lib/weather/view";
import { MODES, type ModeId } from "@/modes/registry";
import { useAppStore } from "@/store/app-store";
import { WeatherBackground } from "../background/weather-background";
import { Composer } from "../community/composer";
import { Skeleton } from "../ui/misc";
import { AlertBanner } from "./alert-banner";
import { AppUpdateNotice } from "./app-update-notice";
import { GUTTER, PAGE_PAD } from "./chrome";
import { CommandPalette } from "./command-palette";
import { TabBar } from "./tab-bar";
import { TopBar } from "./top-bar";

const ModeLoading = () => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
    <Skeleton className="h-64 md:col-span-2" />
    <Skeleton className="h-64" />
    <Skeleton className="h-40 md:col-span-3" />
  </div>
);

/** Map-first modes load into the full area between the bars. */
const MapLoading = () => (
  <div className="absolute inset-0 grid place-items-center bg-canvas">
    <p className="label">Loading map</p>
  </div>
);

// Each mode is its own chunk: the map-heavy modes never load for a user who only reads the daily view.
const MODE_COMPONENTS: Record<ModeId, React.ComponentType> = {
  daily: dynamic(() => import("../modes/daily-mode").then((m) => m.DailyMode), { loading: ModeLoading }),
  severe: dynamic(() => import("../modes/severe-mode").then((m) => m.SevereMode), { ssr: false, loading: MapLoading }),
  drone: dynamic(() => import("../modes/drone-mode").then((m) => m.DroneMode), { loading: ModeLoading }),
  angler: dynamic(() => import("../modes/angler-mode").then((m) => m.AnglerMode), { loading: ModeLoading }),
  air: dynamic(() => import("../modes/air-mode").then((m) => m.AirMode), { ssr: false, loading: ModeLoading }),
};

export function AppShell() {
  useUrlSync();
  const hydrated = useAppStore((s) => s.hydrated);
  const mode = useAppStore((s) => s.mode);
  const location = useAppStore((s) => s.location);
  const forecast = useForecast();
  const localAlerts = useLocalAlerts();
  const nationalAlerts = useNationalAlerts();
  const now = useNow(60_000);
  const def = MODES[mode];
  const Mode = MODE_COMPONENTS[mode];
  const immersive = def.immersiveMap;

  const f = forecast.data;
  const i = f ? currentHourIndex(f, now) : 0;

  return (
    <>
      <WeatherBackground
        lat={location.lat}
        lon={location.lon}
        code={f?.current.code ?? null}
        cloudPct={f?.current.cloud ?? null}
        windMs={f?.current.windSpeed ?? null}
        windDirDeg={f?.current.windDir ?? null}
        precipMm={f?.hourly.precip[i] ?? f?.current.precip ?? null}
        hidden={immersive}
      />
      <TopBar />
      <CommandPalette />
      {COMMUNITY_ENABLED && <Composer />}
      <AppUpdateNotice />

      <main
        className={
          immersive
            ? // The map fills exactly the space between the top bar and the phone tab bar.
              "fixed inset-x-0 top-[var(--topbar-h)] bottom-[var(--tabbar-h)]"
            : cn("relative mx-auto w-full max-w-[1600px]", GUTTER, PAGE_PAD)
        }
      >
        {!immersive && (
          // `empty:hidden` drops the gap when there's no alert.
          <div className="mb-4 empty:hidden">
            <AlertBanner
              local={localAlerts.data?.alerts ?? []}
              national={nationalAlerts.data?.alerts ?? []}
              now={now}
              timeZone={f?.timezone}
            />
          </div>
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={mode}
            className={immersive ? "absolute inset-0" : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {hydrated ? <Mode /> : immersive ? <MapLoading /> : <ModeLoading />}
          </motion.div>
        </AnimatePresence>
      </main>

      <TabBar />
    </>
  );
}
