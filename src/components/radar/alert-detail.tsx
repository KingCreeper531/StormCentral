"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { tagLabel } from "@/lib/alerts";
import type { WeatherAlert } from "@/lib/api/types";
import { eventName } from "@/lib/i18n/nws-events";
import { useT } from "@/lib/i18n/use-t";
import { stormEta } from "@/lib/science/storm-motion";
import { cn } from "@/lib/utils";
import { clockIn } from "@/lib/weather/view";
import { useAppStore } from "@/store/app-store";
import { IconButton } from "../ui/button";
import { AlertTag, HazardSwatch } from "./alert-list";
import { isSpotterSource, type AlertReports } from "@/lib/alert-reports";
import { placeName, reportMagnitude, reportTitle, sourceLabel } from "@/lib/feeds/storm-parse";
import { useFormat } from "@/hooks/use-format";
import { timeAgo } from "@/lib/time";

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  reports,
}: {
  alert: WeatherAlert;
  /** NWS storm reports filed inside the warning (lib/alert-reports). */
  reports?: AlertReports;
  now: number;
  /** IANA zone of the selected location; times use the device's zone when omitted. */
  timeZone: string | undefined;
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const t = useT();
  const loc = useAppStore((s) => s.location);
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const eta = a.motion ? stormEta(a.motion, loc, 15, now) : null;
  const time = (iso: string) => clockIn(timeZone, iso, t.locale);
  const event = eventName(t.lang, a.event);
  const hasFacts = !!(a.hazards.maxHail || a.hazards.maxWind || a.hazards.tornado || a.motion);
  // "Observed" repeats the Tornado fact below.
  const tags = a.hazards.tornado ? a.tags.filter((tag) => tag !== "OBSERVED") : a.tags;
  const issued = (
    <>
      <p className="text-xs text-ink-3">{a.sender}</p>
      <p className="text-xs text-ink-3 tabular">
        {t("Issued {issued}, until {until}", { issued: time(a.sent), until: time(a.ends ?? a.expires) })}
      </p>
    </>
  );

  return (
    <div className={cn("min-w-0", className)} role="dialog" aria-label={event}>
      {hideTitle ? (
        <div>{issued}</div>
      ) : (
        <div className="flex items-start gap-3">
          <HazardSwatch color={a.color} className="mt-2" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base leading-6 font-semibold text-ink">{event}</h3>
            <div className="mt-0.5">{issued}</div>
          </div>
          {onClose && (
            <IconButton label={t("Close alert")} size="sm" onClick={onClose} className="-mt-1 -mr-1.5">
              <X className="size-4" aria-hidden />
            </IconButton>
          )}
        </div>
      )}

      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <AlertTag key={tag}>{tagLabel(tag)}</AlertTag>
          ))}
        </div>
      )}

      {eta != null && (
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
          <span className="label min-w-0">{t("Projected arrival at {place}", { place: loc.name })}</span>
          <span className="shrink-0 text-lg leading-6 font-semibold text-ink tabular">~{Math.round(eta)} min</span>
        </div>
      )}

      {hasFacts && (
        <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 border-t border-line pt-3">
          {a.hazards.maxHail && <Fact label={t("Max hail")}>{a.hazards.maxHail}&quot;</Fact>}
          {a.hazards.maxWind && <Fact label={t("Max wind")}>{a.hazards.maxWind}</Fact>}
          {a.hazards.tornado && (
            <Fact label={t("Tornado")}>{sentence(t(a.hazards.tornado.toLowerCase()))}</Fact>
          )}
          {a.motion && (
            <Fact label={t("Storm motion")}>{t("{deg}° at {speed} kt", { deg: Math.round(a.motion.headingDeg), speed: a.motion.speedKt })}</Fact>
          )}
        </dl>
      )}

      {reports && <SpotterReports r={reports} now={now} />}

      <div className="mt-3 border-t border-line pt-3">
        {a.headline && <p className="text-sm font-medium text-ink">{a.headline}</p>}
        <div id={textId}>
          <p className={cn("text-[13px] leading-relaxed break-words whitespace-pre-line text-ink-2", a.headline && "mt-2", !expanded && "line-clamp-6")}>{a.description}</p>
          {a.instruction && expanded && (
            <div className="mt-3">
              <p className="label">{t("Safety instructions")}</p>
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
          {expanded ? t("Show less") : a.instruction ? t("Full text and safety instructions") : t("Full text")}
        </button>
      </div>
    </div>
  );
}

/** What NWS storm reports (spotters, chasers, emergency managers, the public) say inside the warning. */
function SpotterReports({ r, now }: { r: AlertReports; now: number }) {
  const fmt = useFormat();
  const t = useT();
  const value = (x: AlertReports["reports"][number]) => {
    const m = reportMagnitude(x);
    if (!m) return null;
    if (m.kind === "length") return fmt.precip(m.mm);
    if (m.kind === "speed") return fmt.wind(m.ms);
    if (m.kind === "rating") return m.text;
    return `${m.value}${m.unit ? ` ${m.unit.toLowerCase()}` : ""}`;
  };
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="label">
        {!r.reports.length
          ? t("No storm reports inside this warning yet")
          : r.spotters
            ? t("Storm reports in this warning: {n}, {spotters} from trained spotters and officials", { n: r.reports.length, spotters: r.spotters })
            : t("Storm reports in this warning: {n}", { n: r.reports.length })}
      </p>
      {r.reports.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {r.reports.slice(0, 6).map((x) => {
            const v = value(x);
            return (
              <li key={x.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0">
                  <span className="font-medium text-ink">{t(reportTitle(x.typeText))}</span>
                  {v && <span className="text-ink-2"> · {v}</span>}
                  <span className="block truncate text-xs text-ink-3">
                    {[placeName(x.place), x.source ? t(sourceLabel(x.source)) : null].filter(Boolean).join(" · ")}
                    {isSpotterSource(x.source) ? " ✓" : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink-3 tabular">{timeAgo(Date.parse(x.time), now, t)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
