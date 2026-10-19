"use client";

import { useMemo } from "react";
import { useNow } from "@/hooks/use-now";
import type { LatLon } from "@/lib/geo";
import { destination, stormMotion } from "@/lib/pro/storm-tools";
import { trackPolygon, type Ring } from "@/lib/warngen/geometry";
import { useProStore } from "@/store/pro-store";

const KM_PER_NM = 1.852;

export interface WarnGeometry {
  /** The storm as picked (the later pick when tracked), with its loop time. */
  storm: (LatLon & { t: number }) | null;
  /** Toward-heading and speed: typed in, or from the two picks; null = stationary. */
  motion: { headingDeg: number; speedKt: number } | null;
  /** Where the storm is now, projected from the pick along its motion. */
  now: LatLon | null;
  /** Projected position at the warning's end. */
  end: LatLon | null;
  polygon: Ring | null;
  /** The polygon was drawn from the track (not hand-edited). */
  auto: boolean;
  /** Waiting for the second pick (one so far). */
  tracking: boolean;
}

/**
 * The WarnGen draft's geometry, shared by the editor and every pane's
 * overlay: storm position and motion from the storm-vector picks (or typed
 * in), projected to the present, and the warning polygon.
 */
export function useWarnGeometry(): WarnGeometry {
  const vector = useProStore((s) => s.vector);
  const draft = useProStore((s) => s.warnDraft);
  const clock = useNow(30_000);
  return useMemo(() => {
    const picked = vector?.b ? stormMotion(vector.a, vector.b) : null;
    const storm = picked?.origin ?? (vector ? (vector.b ?? vector.a) : null);
    const motion = draft.motion ?? (picked ? { headingDeg: picked.headingDeg, speedKt: picked.speedKt } : null);
    const moving = !!motion && motion.speedKt >= 3;
    // Carry the storm forward from the frame it was picked on to now (at most an hour).
    const hours = storm ? Math.min(1, Math.max(0, (clock - storm.t) / 3_600_000)) : 0;
    const now = storm ? (moving ? destination(storm, motion!.headingDeg, motion!.speedKt * KM_PER_NM * hours) : { lat: storm.lat, lon: storm.lon }) : null;
    const end = now && moving ? destination(now, motion!.headingDeg, (motion!.speedKt * KM_PER_NM * draft.minutes) / 60) : null;
    const polygon = draft.polygon ?? (now ? trackPolygon(now, moving ? motion : null, draft.minutes) : null);
    return { storm, motion: moving ? motion : null, now, end, polygon, auto: !draft.polygon, tracking: !!vector && !vector.b && !draft.motion };
  }, [vector, draft, clock]);
}
