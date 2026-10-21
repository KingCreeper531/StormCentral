"use client";

import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import { arrivals, minutesUntil, motionFrom, type Motion } from "@/lib/pro/storm-tools";
import type { LatLon } from "@/lib/geo";
import { clockIn } from "@/lib/weather/view";
import { Button } from "../ui/button";

/**
 * Storm vector and time-of-arrival readout: the measured motion, then when
 * the storm's projected track reaches each point (your location, saved
 * places and points you click), path first.
 */
export function StormToolsPanel({
  motion,
  picking,
  points,
  now,
  timeZone,
  onReset,
  onClearPoints,
}: {
  motion: Motion | null;
  /** 0: pick the storm, 1: step the loop and pick it again. */
  picking: 0 | 1 | 2;
  points: (LatLon & { name: string })[];
  /** What "N min" and "passed" count from (the archive's moment when looking back). */
  now: number;
  timeZone?: string;
  onReset: () => void;
  onClearPoints: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const list = motion ? arrivals(motion, points) : [];
  return (
    <div className="space-y-3 p-3 text-[12px]">
      {!motion && (
        <ol className="list-decimal space-y-1 pl-4 text-ink-2">
          <li className={picking === 0 ? "font-semibold text-ink" : ""}>{t("Click the storm's core on any panel.")}</li>
          <li className={picking === 1 ? "font-semibold text-ink" : ""}>{t("Step the loop a few frames (← →) and click the same core again.")}</li>
        </ol>
      )}
      {motion && (
        <div className="grid grid-cols-3 gap-1.5">
          <div className="rounded-[4px] bg-surface-2 px-2 py-1">
            <div className="text-[10px] text-ink-3">{t("From")}</div>
            <div className="font-mono">{String(Math.round(motionFrom(motion))).padStart(3, "0")}°</div>
          </div>
          <div className="rounded-[4px] bg-surface-2 px-2 py-1">
            <div className="text-[10px] text-ink-3">{t("Speed")}</div>
            <div className="font-mono">{Math.round(motion.speedKt)} kt</div>
          </div>
          <div className="rounded-[4px] bg-surface-2 px-2 py-1">
            <div className="text-[10px] text-ink-3">{t("As of")}</div>
            <div className="font-mono">{clockIn(timeZone, motion.origin.t, t.locale)}</div>
          </div>
        </div>
      )}
      {motion && (
        <div>
          <div className="label mb-1">{t("Time of arrival")}</div>
          {list.length ? (
            <ul className="divide-y divide-line rounded-[4px] border border-line">
              {list.map((r) => {
                const left = minutesUntil(r, now);
                return (
                  <li key={`${r.name}-${r.point.lat}-${r.point.lon}`} className="flex items-center gap-2 px-2 py-1.5">
                    <span className={`size-2 shrink-0 rounded-full ${r.inPath ? "bg-caution" : "bg-surface-3"}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="font-mono text-ink-2">
                      {left < 0 ? t("passed") : r.inPath ? clockIn(timeZone, r.at, t.locale) : `${f.distanceKm(r.offTrackKm)} ${t("off track")}`}
                    </span>
                    {r.inPath && left >= 0 && <span className="w-12 text-right font-mono text-ink">{Math.round(left)} min</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-ink-3">{t("Nothing within two hours of the track.")}</p>
          )}
          <p className="mt-1 text-[10px] text-ink-3">{t("Yellow: inside the ±20° fan (likely path). Use the TOA tool to add points.")}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onReset}>
          {t("New vector")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClearPoints}>
          {t("Clear points")}
        </Button>
      </div>
    </div>
  );
}
