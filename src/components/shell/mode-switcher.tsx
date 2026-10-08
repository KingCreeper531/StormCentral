"use client";

import { useHotkeys } from "@/hooks/use-hotkeys";
import { cn } from "@/lib/utils";
import { MODE_IDS, MODES } from "@/modes/registry";
import { useModeNav } from "./use-mode-nav";

/**
 * Desktop mode tabs (md+), rendered in the top bar. Underline tabs whose
 * accent rule sits on the bar's bottom edge. Below xl (tablets, phones in
 * landscape) the short tab-bar label stacks under the icon, since a tooltip
 * never shows on touch; xl+ puts the full label beside it. Hover/focus prefetches
 * the target mode's feeds; keys 1–5 switch instantly (registered here only,
 * so the phone tab bar doesn't double-bind them).
 */
export function ModeSwitcher({ className }: { className?: string }) {
  const { active, select, warm } = useModeNav();

  useHotkeys(Object.fromEntries(MODE_IDS.map((id) => [MODES[id].hotkey, () => select(id)])));

  return (
    <nav aria-label="Operating mode" className={cn("items-stretch", className)}>
      {MODE_IDS.map((id) => {
        const m = MODES[id];
        const Icon = m.Icon;
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => select(id)}
            onPointerEnter={() => warm(id)}
            onFocus={() => warm(id)}
            aria-current={on ? "page" : undefined}
            title={`${m.label} — ${m.tagline} (${m.hotkey})`}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1 px-2 font-medium whitespace-nowrap transition-colors pointer-coarse:min-w-11 xl:flex-row xl:gap-1.5 xl:px-2.5",
              on ? "text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="text-[11px] leading-none xl:hidden">{m.short}</span>
            <span className="hidden text-[13px] xl:inline">{m.label}</span>
            {on && <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-0.5 bg-accent" />}
          </button>
        );
      })}
    </nav>
  );
}
