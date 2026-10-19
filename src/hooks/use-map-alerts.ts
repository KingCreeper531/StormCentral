"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { visibleHazards } from "@/lib/alerts";
import { useAppStore } from "@/store/app-store";
import { spotterAlert } from "@/lib/warngen/alerts";
import { useHazards, useNationalAlerts, useSpotterWarnings } from "./queries";

/**
 * The polygons every radar map draws: NWS storm-based warnings, plus the
 * hazard-map products (watches, advisories, statements, marine, SPC/WPC
 * discussions, other countries' warnings) picked in the radar settings,
 * plus the spotter network's own unofficial warnings for signed-in members.
 * `all` is ordered hazards first, so storm-based warnings paint on top.
 */
export function useMapAlerts() {
  const { showWarnings, alertKinds, intlAlerts, showSpotter } = useAppStore(
    useShallow((s) => ({ showWarnings: s.radar.showWarnings, alertKinds: s.radar.alertKinds, intlAlerts: s.radar.intlAlerts, showSpotter: s.radar.showSpotterWarnings })),
  );
  const national = useNationalAlerts(true);
  const hazardsQ = useHazards(showWarnings && alertKinds.length > 0);
  const hazards = useMemo(
    () => (showWarnings ? visibleHazards(hazardsQ.data?.alerts ?? [], national.data?.alerts ?? [], alertKinds, intlAlerts) : []),
    [hazardsQ.data, national.data, showWarnings, alertKinds, intlAlerts],
  );
  const spotterQ = useSpotterWarnings(showSpotter);
  const spotter = useMemo(
    () => (showSpotter ? (spotterQ.data?.warnings ?? []).filter((w) => w.status === "active").map((w) => spotterAlert(w)) : []),
    [spotterQ.data, showSpotter],
  );
  const all = useMemo(() => [...hazards, ...spotter, ...(national.data?.alerts ?? [])], [hazards, spotter, national.data]);
  return { national, hazards, spotter, all, hazardsFailed: hazardsQ.data?.failed ?? [] };
}
