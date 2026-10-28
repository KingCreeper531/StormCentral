"use client";

import { useMemo } from "react";
import { useArchivedAlerts, useLocalAlerts, useNationalAlerts } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import type { WeatherAlert } from "@/lib/api/types";
import { broadcastWarnings, warningLowerThird, type LowerThird } from "@/lib/broadcast/graphics";
import { useT } from "@/lib/i18n/use-t";
import { useAppStore } from "@/store/app-store";
import { useBroadcastStore, type BroadcastScene } from "@/store/broadcast-store";

/**
 * The alerts the graphics follow (broadcastWarnings picks the official
 * warnings among them): the national list and the location's own, or the
 * warnings in effect at the archive's moment. Of their own rather than the
 * radar map's, so the Pro view has them too.
 */
function useBroadcastAlerts(): readonly WeatherAlert[] {
  const archiveAt = useAppStore((s) => s.archiveAt);
  const archived = useArchivedAlerts(archiveAt);
  const live = useNationalAlerts(archiveAt == null);
  const local = useLocalAlerts();
  const national = archiveAt != null ? archived.data : live.data;
  return useMemo(() => [...(national?.alerts ?? []), ...(archiveAt == null ? (local.data?.alerts ?? []) : [])], [national, local.data, archiveAt]);
}

/**
 * What the on-air graphics say, on the radar map or in the Pro view: the
 * warnings in effect, and the lower third (a warning picked on the map, with
 * its countdown, else the scene, else the look's title and subtitle).
 */
export function useBroadcastGraphics({
  activeAlert,
  scene,
  title,
  placeName,
  timeZone,
}: {
  activeAlert?: WeatherAlert;
  scene: BroadcastScene | null;
  /** The radar product, e.g. "NEXRAD mosaic, reflectivity". */
  title: string;
  placeName: string;
  timeZone?: string;
}) {
  const t = useT();
  const now = useNow(30_000);
  const alerts = useBroadcastAlerts();
  const look = useBroadcastStore((s) => s.look);
  const accent = useBroadcastStore((s) => s.accent);
  const warnings = useMemo(() => broadcastWarnings(alerts, now), [alerts, now]);
  const lower = useMemo<LowerThird>(() => {
    if (activeAlert) return warningLowerThird(activeAlert, timeZone, t);
    // A warning keeps its own words and colour; otherwise the look's title, subtitle and bar colour apply.
    const subtitle = look.lowerSubtitle.trim() || title;
    const color = look.lowerColor ?? accent;
    if (scene) return { title: scene.name.toUpperCase(), subtitle, color, ends: null };
    return { title: (look.lowerTitle.trim() || placeName || title).toUpperCase(), subtitle, color, ends: null };
  }, [activeAlert, scene, title, placeName, timeZone, t, accent, look]);
  return { warnings, lower, lowerKey: activeAlert?.id ?? scene?.id ?? "view" };
}
