"use client";

import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { MODES, visibleModes } from "@/modes/registry";
import { useAppStore } from "@/store/app-store";
import { useModeNav } from "./use-mode-nav";

/**
 * Phone navigation (< md): the modes (five, six with Professional Mode on) in a fixed bottom bar, safe-area
 * padded. Its height is `--tabbar-h`, which page shells pad by.
 */
export function TabBar() {
  const { active, select } = useModeNav();
  const t = useT();
  const modes = visibleModes(useAppStore((s) => s.professional));

  return (
    <nav
      aria-label={t("Operating mode")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid h-14" style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}>
        {modes.map((id) => {
          const m = MODES[id];
          const Icon = m.Icon;
          const on = id === active;
          return (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-current={on ? "page" : undefined}
              title={`${t(m.label)} — ${t(m.tagline)}`}
              className={cn(
                "relative flex min-w-0 flex-col items-center justify-center gap-1 transition-colors",
                on ? "text-ink" : "text-ink-3 active:text-ink-2",
              )}
            >
              {on && <span aria-hidden className="absolute inset-x-3 -top-px h-0.5 bg-accent" />}
              <Icon className="size-5 shrink-0" strokeWidth={on ? 2 : 1.75} aria-hidden />
              <span className="max-w-full truncate px-1 text-[11px] leading-none font-medium">{t(m.short)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
