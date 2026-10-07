"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { prefetchMode } from "@/hooks/queries";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { cn } from "@/lib/utils";
import { MODE_IDS, MODES, type ModeId } from "@/modes/registry";
import { useAppStore } from "@/store/app-store";
import { WeatherIcon } from "../ui/weather-icon";

/**
 * Mode switcher. Hover/focus prefetches the target mode's feeds so the
 * switch lands on data, not skeletons; keys 1–5 switch instantly.
 */
export function ModeSwitcher({ variant = "bar" }: { variant?: "bar" | "dock" }) {
  const storeMode = useAppStore((s) => s.mode);
  const setStoreMode = useAppStore((s) => s.setMode);
  const qc = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  // From sub-pages (community, profiles) a mode pick also navigates home.
  const setMode = (m: ModeId) => {
    setStoreMode(m);
    if (pathname !== "/") router.push("/");
  };
  const warm = (m: ModeId) => prefetchMode(qc, m, useAppStore.getState().location);

  useHotkeys(Object.fromEntries(MODE_IDS.map((id) => [MODES[id].hotkey, () => setMode(id)])));

  return (
    <nav
      aria-label="Operating mode"
      className={cn(
        "flex items-center gap-0.5 rounded-full p-1",
        variant === "bar" ? "glass" : "glass-strong w-full justify-between rounded-2xl",
      )}
    >
      {MODE_IDS.map((id) => {
        const m = MODES[id];
        const active = id === storeMode && pathname === "/";
        return (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            onPointerEnter={() => warm(id)}
            onFocus={() => warm(id)}
            aria-current={active ? "page" : undefined}
            title={`${m.label} — ${m.tagline} (${m.hotkey})`}
            className={cn(
              "relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              variant === "dock" && "flex-1 flex-col gap-0.5 rounded-xl px-1 py-1.5 text-[10px]",
              active ? "text-white" : "text-ink-3 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`mode-pill-${variant}`}
                className={cn("absolute inset-0", variant === "dock" ? "rounded-xl" : "rounded-full")}
                style={{
                  background: `color-mix(in oklab, ${m.accent} 22%, transparent)`,
                  boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${m.accent} 55%, transparent), 0 0 24px -4px ${m.accent}`,
                }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <WeatherIcon name={m.icon} size={variant === "dock" ? 26 : 22} animated={false} className="relative -my-1" />
            <span className={cn("relative", variant === "bar" && !active && "hidden xl:inline")}>{m.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
