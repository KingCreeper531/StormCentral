"use client";

import { Megaphone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useForecast, useLocalAlerts, useNationalAlerts } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { useUrlSync } from "@/hooks/use-url-sync";
import { currentHourIndex } from "@/lib/weather/view";
import { MODES, type ModeId } from "@/modes/registry";
import { useAppStore } from "@/store/app-store";
import { WeatherBackground } from "../background/weather-background";
import { Composer } from "../community/composer";
import { Skeleton } from "../ui/misc";
import { AlertBanner } from "./alert-banner";
import { CommandPalette } from "./command-palette";
import { ModeSwitcher } from "./mode-switcher";
import { TopBar } from "./top-bar";

const ModeLoading = () => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
    <Skeleton className="h-64 md:col-span-2" />
    <Skeleton className="h-64" />
    <Skeleton className="h-40 md:col-span-3" />
  </div>
);

// Each mode is its own chunk: the map-heavy modes never load for a user who only reads the daily view.
const MODE_COMPONENTS: Record<ModeId, React.ComponentType> = {
  daily: dynamic(() => import("../modes/daily-mode").then((m) => m.DailyMode), { loading: ModeLoading }),
  severe: dynamic(() => import("../modes/severe-mode").then((m) => m.SevereMode), { ssr: false, loading: ModeLoading }),
  drone: dynamic(() => import("../modes/drone-mode").then((m) => m.DroneMode), { loading: ModeLoading }),
  angler: dynamic(() => import("../modes/angler-mode").then((m) => m.AnglerMode), { loading: ModeLoading }),
  air: dynamic(() => import("../modes/air-mode").then((m) => m.AirMode), { ssr: false, loading: ModeLoading }),
};

export function AppShell() {
  useUrlSync();
  const hydrated = useAppStore((s) => s.hydrated);
  const mode = useAppStore((s) => s.mode);
  const location = useAppStore((s) => s.location);
  const setComposerOpen = useAppStore((s) => s.setComposerOpen);
  const forecast = useForecast();
  const localAlerts = useLocalAlerts();
  const nationalAlerts = useNationalAlerts();
  const now = useNow(60_000);
  const def = MODES[mode];
  const Mode = MODE_COMPONENTS[mode];

  // Re-theme everything (focus rings, pills, glows) from the active mode.
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", def.accent);
  }, [def.accent]);

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
        hidden={def.immersiveMap}
      />
      <TopBar />
      <CommandPalette />
      <Composer />

      <main className={def.immersiveMap ? "fixed inset-0" : "relative mx-auto max-w-[1600px] px-3 pt-20 pb-28 sm:px-5 md:pb-12"}>
        {!def.immersiveMap && (
          <div className="mb-4">
            <AlertBanner local={localAlerts.data?.alerts ?? []} national={nationalAlerts.data?.alerts ?? []} now={now} />
          </div>
        )}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={mode}
            className={def.immersiveMap ? "absolute inset-0" : undefined}
            initial={{ opacity: 0, y: 14, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.995 }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          >
            {hydrated ? <Mode /> : <ModeLoading />}
          </motion.div>
        </AnimatePresence>
      </main>

      <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 md:hidden">
        <ModeSwitcher variant="dock" />
      </div>

      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className={`fixed right-5 z-40 flex items-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-black shadow-[0_10px_40px_-8px_rgba(255,255,255,.45)] transition-transform hover:scale-105 active:scale-95 ${
          def.immersiveMap ? "bottom-24 md:bottom-28" : "bottom-24 md:bottom-6"
        }`}
      >
        <Megaphone className="size-4" aria-hidden />
        <span className="hidden sm:inline">Report weather</span>
        <span className="sr-only sm:hidden">Report weather</span>
      </button>
    </>
  );
}
