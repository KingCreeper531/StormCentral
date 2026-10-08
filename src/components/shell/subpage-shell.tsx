"use client";

import { useForecast } from "@/hooks/queries";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { WeatherBackground } from "../background/weather-background";
import { Composer } from "../community/composer";
import { GUTTER, PAGE_PAD } from "./chrome";
import { CommandPalette } from "./command-palette";
import { TabBar } from "./tab-bar";
import { TopBar } from "./top-bar";

/** Chrome for secondary pages: same sky, top bar and tab bar, with a narrower content column. */
export function SubpageShell({ children, width = "max-w-2xl" }: { children: React.ReactNode; width?: string }) {
  const loc = useAppStore((s) => s.location);
  const f = useForecast().data;
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
      {COMMUNITY_ENABLED && <Composer />}
      <main className={cn("relative mx-auto w-full", GUTTER, PAGE_PAD, width)}>{children}</main>
      <TabBar />
    </>
  );
}
