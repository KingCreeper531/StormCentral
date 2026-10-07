"use client";

import { ChevronRight, Siren } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import { geometryContains } from "@/lib/geo";
import { stormEta } from "@/lib/science/storm-motion";
import { useAppStore } from "@/store/app-store";

/**
 * Highest-priority alert for the selected location. Storm-based polygons are
 * tested point-in-polygon, and an approaching storm gets a live ETA.
 */
export function AlertBanner({ local, national, now }: { local: WeatherAlert[]; national: WeatherAlert[]; now: number }) {
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
  const urgent = a && (a.event === "Tornado Warning" || a.tags.some((t) => t.includes("EMERGENCY")));

  return (
    <AnimatePresence>
      {(a || top.approaching) && (
        <motion.button
          type="button"
          onClick={() => setMode("severe")}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="glass group flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left"
          style={{ boxShadow: `inset 0 0 0 1px ${(a ?? top.approaching!.a).color}66, 0 0 40px -12px ${(a ?? top.approaching!.a).color}` }}
        >
          <span className="relative grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `${(a ?? top.approaching!.a).color}26` }}>
            {urgent && <span className="absolute inset-0 animate-pulse-ring rounded-full" style={{ background: a!.color }} />}
            <Siren className="relative size-4" style={{ color: (a ?? top.approaching!.a).color }} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            {a ? (
              <>
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                  {a.event}
                  {a.tags.map((t) => (
                    <span key={t} className="rounded-md bg-white/10 px-1.5 py-px text-[10px] font-bold tracking-wide">
                      {t}
                    </span>
                  ))}
                </span>
                <span className="block truncate text-xs text-ink-2">
                  {top.insideCount > 0 ? "Your location is inside the warning polygon · " : ""}
                  until {new Date(a.ends ?? a.expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {top.approaching ? ` · storm ETA ~${Math.round(top.approaching.eta)} min` : ""}
                </span>
              </>
            ) : (
              <>
                <span className="block text-sm font-semibold text-ink">{top.approaching!.a.event} approaching</span>
                <span className="block truncate text-xs text-ink-2">Projected arrival in ~{Math.round(top.approaching!.eta)} min based on NWS storm motion</span>
              </>
            )}
          </span>
          <ChevronRight className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
