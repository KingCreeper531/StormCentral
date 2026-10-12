"use client";

import { Crosshair, FastForward, Satellite, TriangleAlert, Waves, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RadarSettings } from "@/store/app-store";

const SAT_NEXT: Record<RadarSettings["satellite"], RadarSettings["satellite"]> = { off: "infrared", infrared: "visible", visible: "off" };
const SAT_BADGE: Record<RadarSettings["satellite"], string | null> = { off: null, infrared: "IR", visible: "VIS" };

function Chip({ label, on, onClick, children, badge }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode; badge?: string | null }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={cn(
        "overlay relative grid size-10 place-items-center transition-colors pointer-coarse:size-11",
        on ? "!border-accent text-accent" : "text-ink-2 hover:text-ink",
      )}
    >
      {children}
      {badge && <span className="absolute -bottom-1 -left-1 rounded-[3px] bg-accent px-1 font-mono text-[9px] leading-3.5 font-semibold text-canvas">{badge}</span>}
    </button>
  );
}

/**
 * One-tap radar layers on the map itself, so the common switches don't need
 * the settings panel: satellite (off, infrared, visible), lightning,
 * warnings, future radar, smoothing, and the tap-to-read inspector.
 */
export function RadarQuickLayers({
  settings,
  onChange,
  inspect,
  onInspect,
  futureAvailable,
  className,
}: {
  settings: RadarSettings;
  onChange: (r: Partial<RadarSettings>) => void;
  inspect: boolean;
  onInspect: (on: boolean) => void;
  futureAvailable: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} role="toolbar" aria-label="Radar layers" aria-orientation="vertical">
      <Chip
        label={`Satellite: ${settings.satellite === "off" ? "off" : settings.satellite}. Tap to change.`}
        on={settings.satellite !== "off"}
        badge={SAT_BADGE[settings.satellite]}
        onClick={() => onChange({ satellite: SAT_NEXT[settings.satellite] })}
      >
        <Satellite className="size-4.5" aria-hidden />
      </Chip>
      <Chip label="Lightning" on={settings.showLightning} onClick={() => onChange({ showLightning: !settings.showLightning })}>
        <Zap className="size-4.5" aria-hidden />
      </Chip>
      <Chip label="Warnings" on={settings.showWarnings} onClick={() => onChange({ showWarnings: !settings.showWarnings })}>
        <TriangleAlert className="size-4.5" aria-hidden />
      </Chip>
      {futureAvailable && (
        <Chip label="Future radar" on={settings.future} onClick={() => onChange({ future: !settings.future })}>
          <FastForward className="size-4.5" aria-hidden />
        </Chip>
      )}
      <Chip label="Smoothed radar" on={settings.smooth} onClick={() => onChange({ smooth: !settings.smooth })}>
        <Waves className="size-4.5" aria-hidden />
      </Chip>
      <Chip label={inspect ? "Inspector on: tap the map to read the radar" : "Inspect: tap the map to read the radar"} on={inspect} onClick={() => onInspect(!inspect)}>
        <Crosshair className="size-4.5" aria-hidden />
      </Chip>
    </div>
  );
}
