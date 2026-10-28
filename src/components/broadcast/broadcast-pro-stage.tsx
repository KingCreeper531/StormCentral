"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useForecast } from "@/hooks/queries";
import type { Insets } from "@/lib/broadcast/pro-view";
import { useT } from "@/lib/i18n/use-t";
import { getSite, nearestSites } from "@/lib/radar/site-utils";
import { useAppStore } from "@/store/app-store";
import { useProStore } from "@/store/pro-store";
import { BroadcastControls } from "./broadcast-controls";
import { BroadcastDialog } from "./broadcast-dialog";
import { BroadcastOverlay } from "./broadcast-overlay";
import { useBroadcastGraphics } from "./use-broadcast-graphics";

function Loading() {
  const t = useT();
  return (
    <div className="grid h-full place-items-center">
      <p className="label">{t("Loading map")}</p>
    </div>
  );
}

const ProfessionalWorkspace = dynamic(() => import("../pro/professional-workspace").then((m) => m.ProfessionalWorkspace), { ssr: false, loading: Loading });

/** Room for the control bar along the top (touch screens' buttons are taller), so it never covers the workspace's toolbar. */
const CONTROLS_CLEARANCE = 64;

/**
 * Broadcast mode's Pro view: Professional mode's panels in place of the
 * radar map, under the same on-air graphics. The workspace sits between the
 * graphics along the top and the lower third and ticker along the bottom,
 * so its toolbars and readout stay in reach. Scenes, loop exports and the
 * layers menu are the map's, so they wait for the way back.
 */
export function BroadcastProStage({ onExit }: { onExit: () => void }) {
  const t = useT();
  const loc = useAppStore((s) => s.location);
  const pinned = useProStore((s) => s.site);
  const timeZone = useForecast().data?.timezone;
  const [settings, setSettings] = useState(false);
  const [insets, setInsets] = useState<Insets>({ top: 0, bottom: 0 });

  const placeName = loc.name === "My location" ? t(loc.name) : loc.name;
  // The workspace's radar: the pinned site, else the nearest one (as the workspace picks it).
  const site = getSite(pinned) ?? nearestSites(loc, 1)[0]!;
  const { warnings, lower, lowerKey } = useBroadcastGraphics({ scene: null, title: t("{site} multi-panel radar", { site: site.icao }), placeName, timeZone });

  return (
    <>
      <div className="absolute inset-x-0" style={{ top: Math.max(insets.top, CONTROLS_CLEARANCE), bottom: insets.bottom }}>
        <ProfessionalWorkspace />
      </div>
      <BroadcastOverlay warnings={warnings} lower={lower} lowerKey={lowerKey} timeZone={timeZone} onInsets={setInsets} />
      <BroadcastControls onSettings={() => setSettings(true)} onExit={onExit} />
      <BroadcastDialog open={settings} onClose={() => setSettings(false)} />
    </>
  );
}
