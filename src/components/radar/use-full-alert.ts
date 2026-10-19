"use client";

import { useMemo } from "react";
import { useAlertText } from "@/hooks/queries";
import type { WeatherAlert } from "@/lib/api/types";

/**
 * A hazard-map alert with its full text filled in once fetched (the map feed
 * sends watches, advisories and discussions without it). Alerts that already
 * carry their text come back unchanged.
 */
export function useFullAlert(given: WeatherAlert): { alert: WeatherAlert; loading: boolean; failed: boolean } {
  const q = useAlertText(given);
  const alert = useMemo<WeatherAlert>(() => {
    if (!given.lean || !q.data) return given;
    const full = q.data.alert;
    if (full)
      return {
        ...given,
        headline: full.headline,
        description: full.description,
        instruction: full.instruction,
        areaDesc: full.areaDesc,
        severity: full.severity,
        urgency: full.urgency,
        certainty: full.certainty,
        sender: full.sender,
        hazards: full.hazards,
        tags: full.tags,
        motion: full.motion,
        lean: false,
      };
    if (q.data.text) return { ...given, description: q.data.text, lean: false };
    return given;
  }, [given, q.data]);
  return { alert, loading: !!given.lean && q.isFetching && !q.data, failed: !!given.lean && q.isError };
}

/** A human-readable page for the product, where one exists. */
export function productLink(a: WeatherAlert): string | null {
  const md = /^spc-md-(\d{4})-(\d{4})$/.exec(a.id);
  if (md) return `https://www.spc.noaa.gov/products/md/${md[1]}/md${md[2]}.html`;
  const mpd = /^wpc-mpd-(\d{4})-(\d{4})$/.exec(a.id);
  if (mpd) return `https://www.wpc.ncep.noaa.gov/metwatch/metwatch_mpd_multi.php?md=${Number(mpd[2])}&yr=${mpd[1]}`;
  if (a.source === "nws" || !a.source) return null;
  return a.url ?? null;
}
