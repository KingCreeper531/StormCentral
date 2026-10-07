"use client";

import { useEffect } from "react";
import { useForecast } from "@/hooks/queries";
import { useAppStore } from "@/store/app-store";
import { WeatherBackground } from "../background/weather-background";
import { Composer } from "../community/composer";
import { CommandPalette } from "./command-palette";
import { ModeSwitcher } from "./mode-switcher";
import { TopBar } from "./top-bar";

/** Chrome for secondary pages: same live sky + top bar, narrow content column. */
export function SubpageShell({ children, width = "max-w-2xl" }: { children: React.ReactNode; width?: string }) {
  const loc = useAppStore((s) => s.location);
  const f = useForecast().data;
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", "#38bdf8");
  }, []);
  return (
    <>
      <WeatherBackground
        lat={loc.lat}
        lon={loc.lon}
        code={f?.current.code ?? null}
        cloudPct={f?.current.cloud ?? null}
        windMs={f?.current.windSpeed ?? null}
        windDirDeg={f?.current.windDir ?? null}
        precipMm={f?.current.precip ?? null}
      />
      <TopBar />
      <CommandPalette />
      <Composer />
      <main className={`relative mx-auto px-4 pt-24 pb-28 md:pb-16 ${width}`}>{children}</main>
      <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 md:hidden">
        <ModeSwitcher variant="dock" />
      </div>
    </>
  );
}
