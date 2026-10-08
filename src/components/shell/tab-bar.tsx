"use client";

import { cn } from "@/lib/utils";
import { MODE_IDS, MODES } from "@/modes/registry";
import { useModeNav } from "./use-mode-nav";

/**
 * Phone navigation (< md): the five modes in a fixed bottom bar, safe-area
 * padded. Its height is `--tabbar-h`, which page shells pad by.
 */
export function TabBar() {
  const { active, select } = useModeNav();

  return (
    <nav
      aria-label="Operating mode"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid h-14 grid-cols-5">
        {MODE_IDS.map((id) => {
          const m = MODES[id];
          const Icon = m.Icon;
          const on = id === active;
          return (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-current={on ? "page" : undefined}
              title={`${m.label} — ${m.tagline}`}
              className={cn(
                "relative flex min-w-0 flex-col items-center justify-center gap-1 transition-colors",
                on ? "text-ink" : "text-ink-3 active:text-ink-2",
              )}
            >
              {on && <span aria-hidden className="absolute inset-x-3 -top-px h-0.5 bg-accent" />}
              <Icon className="size-5 shrink-0" strokeWidth={on ? 2 : 1.75} aria-hidden />
              <span className="max-w-full truncate px-1 text-[11px] leading-none font-medium">{m.short}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
