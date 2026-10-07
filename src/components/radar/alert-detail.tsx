"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { tagLabel } from "@/lib/alerts";
import type { WeatherAlert } from "@/lib/api/types";
import { stormEta } from "@/lib/science/storm-motion";
import { cn } from "@/lib/utils";
import { clockIn } from "@/lib/weather/view";
import { useAppStore } from "@/store/app-store";
import { IconButton } from "../ui/button";
import { AlertTag, HazardSwatch } from "./alert-list";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-lg leading-6 font-medium break-words text-ink tabular">{children}</dd>
    </div>
  );
}

/**
 * Full warning text and impact facts. Unstyled container: the caller places
 * it (map overlay on desktop, inside the bottom sheet on phones).
 * `onClose` renders a close button in the title row; `hideTitle` drops the
 * swatch and event name when the surrounding header already shows them.
 */
export function AlertDetail({
  alert: a,
  now,
  onClose,
  hideTitle = false,
  className,
  timeZone,
}: {
  alert: WeatherAlert;
  now: number;
  /** IANA zone of the selected location; times use the device's zone when omitted. */
  timeZone: string | undefined;
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const loc = useAppStore((s) => s.location);
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const eta = a.motion ? stormEta(a.motion, loc, 15, now) : null;
  const time = (iso: string) => clockIn(timeZone, iso);
  const hasFacts = !!(a.hazards.maxHail || a.hazards.maxWind || a.hazards.tornado || a.motion);
  // "Observed" repeats the Tornado fact below.
  const tags = a.hazards.tornado ? a.tags.filter((t) => t !== "OBSERVED") : a.tags;
  const issued = (
    <>
      <p className="text-xs text-ink-3">{a.sender}</p>
      <p className="text-xs text-ink-3 tabular">
        Issued {time(a.sent)}, until {time(a.ends ?? a.expires)}
      </p>
    </>
  );

  return (
    <div className={cn("min-w-0", className)} role="dialog" aria-label={a.event}>
      {hideTitle ? (
        <div>{issued}</div>
      ) : (
        <div className="flex items-start gap-3">
          <HazardSwatch color={a.color} className="mt-2" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base leading-6 font-semibold text-ink">{a.event}</h3>
            <div className="mt-0.5">{issued}</div>
          </div>
          {onClose && (
            <IconButton label="Close alert" size="sm" onClick={onClose} className="-mt-1 -mr-1.5">
              <X className="size-4" aria-hidden />
            </IconButton>
          )}
        </div>
      )}

      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {tags.map((t) => (
            <AlertTag key={t}>{tagLabel(t)}</AlertTag>
          ))}
        </div>
      )}

      {eta != null && (
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
          <span className="label min-w-0">Projected arrival at {loc.name}</span>
          <span className="shrink-0 text-lg leading-6 font-semibold text-ink tabular">~{Math.round(eta)} min</span>
        </div>
      )}

      {hasFacts && (
        <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 border-t border-line pt-3">
          {a.hazards.maxHail && <Fact label="Max hail">{a.hazards.maxHail}&quot;</Fact>}
          {a.hazards.maxWind && <Fact label="Max wind">{a.hazards.maxWind}</Fact>}
          {a.hazards.tornado && (
            <Fact label="Tornado">
              <span className="capitalize">{a.hazards.tornado.toLowerCase()}</span>
            </Fact>
          )}
          {a.motion && (
            <Fact label="Storm motion">
              {Math.round(a.motion.headingDeg)}° at {a.motion.speedKt} kt
            </Fact>
          )}
        </dl>
      )}

      <div className="mt-3 border-t border-line pt-3">
        {a.headline && <p className="text-sm font-medium text-ink">{a.headline}</p>}
        <div id={textId}>
          <p className={cn("text-[13px] leading-relaxed break-words whitespace-pre-line text-ink-2", a.headline && "mt-2", !expanded && "line-clamp-6")}>{a.description}</p>
          {a.instruction && expanded && (
            <div className="mt-3">
              <p className="label">Safety instructions</p>
              <p className="mt-1 text-[13px] leading-relaxed break-words whitespace-pre-line text-ink">{a.instruction}</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-controls={textId}
          className="mt-2 inline-flex items-center text-[13px] font-medium text-accent hover:underline pointer-coarse:min-h-11"
        >
          {expanded ? "Show less" : a.instruction ? "Full text and safety instructions" : "Full text"}
        </button>
      </div>
    </div>
  );
}
