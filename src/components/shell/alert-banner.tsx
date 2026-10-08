"use client";

import { ChevronRight, Siren } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { tagLabel } from "@/lib/alerts";
import type { WeatherAlert } from "@/lib/api/types";
import { geometryContains } from "@/lib/geo";
import { stormEta } from "@/lib/science/storm-motion";
import { clockIn } from "@/lib/weather/view";
import { useAppStore } from "@/store/app-store";

/** Tag chip recipe from DESIGN.md §5. */
const CHIP = "max-w-full truncate rounded-[4px] border border-line px-1.5 py-px text-[11px] font-medium text-ink-2";

/**
 * Highest-priority alert for the selected location. Storm-based polygons are
 * tested point-in-polygon, and an approaching storm gets a live ETA. The
 * whole banner is a button that opens Severe mode. Times are shown in the
 * forecast location's time zone, like the rest of Daily.
 */
export function AlertBanner({
  local,
  national,
  now,
  timeZone,
}: {
  local: WeatherAlert[];
  national: WeatherAlert[];
  now: number;
  /** IANA zone of the selected location; the viewer's zone when omitted. */
  timeZone?: string;
}) {
  const loc = useAppStore((s) => s.location);
  const setMode = useAppStore((s) => s.setMode);

  const top = useMemo(() => {
    const inside = national.filter((a) => geometryContains(a.geometry, loc));
    const all = [...inside, ...local.filter((l) => !inside.some((i) => i.id === l.id))].sort((a, b) => b.rank - a.rank);
    const approaching = national
      .filter((a) => a.motion && !inside.includes(a))
      .map((a) => ({ a, eta: stormEta(a.motion!, loc, 12, now) }))
      .filter((x): x is { a: WeatherAlert; eta: number } => x.eta != null && x.eta < 90)
      .sort((x, y) => x.eta - y.eta)[0];
    return { alert: all[0], insideCount: inside.length, approaching };
  }, [local, national, loc, now]);

  const a = top.alert;
  const subject = a ?? top.approaching?.a;
  const until = a ? clockIn(timeZone, a.ends ?? a.expires) : "";
  const eta = top.approaching ? Math.round(top.approaching.eta) : null;

  return (
    <AnimatePresence initial={false}>
      {subject && (
        <motion.button
          key="alert"
          type="button"
          onClick={() => setMode("severe")}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="relative flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface-1 py-2.5 pr-3 pl-4 text-left transition-colors hover:bg-surface-2 sm:pr-4"
        >
          {/* Hazard colour as a straight inner bar (clipped by the corners), not a curved left border. */}
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: subject.color }} />
          <Siren className="size-4 shrink-0" style={{ color: subject.color }} aria-hidden />

          <span className="min-w-0 flex-1">
            {a ? (
              <>
                {/* Every tag stays visible on phones ("Tornado observed" matters most); the row wraps instead. */}
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="max-w-full truncate text-sm font-semibold text-ink">{a.event}</span>
                  {a.tags.map((t) => (
                    <span key={t} className={CHIP}>
                      {tagLabel(t)}
                    </span>
                  ))}
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink-2">
                  {top.insideCount > 0 && (
                    <>
                      <span className="sm:hidden">Inside the warning area · </span>
                      <span className="hidden sm:inline">Your location is inside the warning polygon · </span>
                    </>
                  )}
                  Until {until}
                  {eta != null && ` · Storm ETA about ${eta} min`}
                </span>
              </>
            ) : (
              <>
                <span className="block truncate text-sm font-semibold text-ink">{subject.event} approaching</span>
                <span className="mt-0.5 block truncate text-xs text-ink-2">Arrival in about {eta} min, based on NWS storm motion</span>
              </>
            )}
          </span>

          <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
