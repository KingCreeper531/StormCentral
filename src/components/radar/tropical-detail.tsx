"use client";

import { ExternalLink, X } from "lucide-react";
import { useFormat } from "@/hooks/use-format";
import type { TropicalStorm } from "@/lib/feeds/tropical";
import { cn } from "@/lib/utils";
import { clockIn, fmtIn } from "@/lib/weather/view";
import { IconButton } from "../ui/button";
import { IntensitySwatch, intensityName, ktToMs, movementText, positionText } from "./tropical-list";

function Fact({ label, sub, children }: { label: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-lg leading-6 font-medium break-words text-ink tabular">{children}</dd>
      {sub && <dd className="text-xs text-ink-3 tabular">{sub}</dd>}
    </div>
  );
}

/** Weekday formatters by zone; a 5-day forecast needs the day as well as the clock. */
const weekdays = new Map<string, Intl.DateTimeFormat>();
function weekday(tz: string | undefined, iso: string) {
  let f = weekdays.get(tz ?? "");
  if (!f) {
    try {
      f = fmtIn(tz, { weekday: "short" });
    } catch {
      f = fmtIn(undefined, { weekday: "short" }); // unknown zone name: device clock
    }
    weekdays.set(tz ?? "", f);
  }
  return f.format(new Date(iso));
}

/**
 * One tropical cyclone: intensity facts, the NHC forecast as a timeline and a
 * link to the advisory. Unstyled container: the caller places it (map
 * overlay on desktop, inside the bottom sheet on phones).
 */
export function TropicalDetail({
  storm: s,
  timeZone,
  onClose,
  className,
}: {
  storm: TropicalStorm;
  /** IANA zone of the selected location; times use the device's zone when omitted. */
  timeZone: string | undefined;
  onClose?: () => void;
  className?: string;
}) {
  const fmt = useFormat();
  const issued = s.advisory?.issued ?? s.updated;
  const status = intensityName(s.label);

  return (
    <div className={cn("min-w-0", className)} role="dialog" aria-label={s.title}>
      <div className="flex items-start gap-3">
        <IntensitySwatch label={s.label} className="mt-2" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-6 font-semibold text-ink">{s.title}</h3>
          <p className="mt-0.5 text-xs text-ink-3">{s.basin ? `National Hurricane Center, ${s.basin}` : "National Hurricane Center"}</p>
          {s.updated && <p className="text-xs text-ink-3 tabular">Updated {clockIn(timeZone, s.updated)}</p>}
        </div>
        {onClose && (
          <IconButton label="Close storm" size="sm" onClick={onClose} className="-mt-1 -mr-1.5">
            <X className="size-4" aria-hidden />
          </IconButton>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 border-t border-line pt-3">
        {s.category != null ? <Fact label="Category">{s.category}</Fact> : <Fact label="Classification">{status ?? (s.classification || "—")}</Fact>}
        <Fact label="Max wind" sub={s.windKt != null && fmt.units.wind !== "kn" ? `${Math.round(s.windKt)} kt` : undefined}>
          {fmt.wind(ktToMs(s.windKt))}
        </Fact>
        <Fact label="Pressure">{fmt.pressure(s.pressureMb)}</Fact>
        <Fact label="Movement">{movementText(s.movement, fmt)}</Fact>
        <Fact label="Position">{positionText(s.lat, s.lon)}</Fact>
        <Fact label="Last advisory" sub={s.advisory?.number ? `Advisory ${s.advisory.number}` : undefined}>
          {issued ? clockIn(timeZone, issued) : "—"}
        </Fact>
      </dl>

      {s.forecast.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h4 className="text-[13px] font-semibold text-ink">Forecast</h4>
          <table className="mt-1.5 w-full text-[13px] tabular">
            <thead>
              <tr className="text-left">
                <th scope="col" className="label pb-1 font-normal">
                  Time
                </th>
                <th scope="col" className="label pb-1 font-normal">
                  Intensity
                </th>
                <th scope="col" className="label pb-1 text-right font-normal">
                  Wind
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.forecast.map((p, i) => (
                <tr key={`${p.tau ?? i}-${p.lat}-${p.lon}`}>
                  <td className="py-1.5 pr-2 text-ink-2">{p.time ? `${weekday(timeZone, p.time)} ${clockIn(timeZone, p.time)}` : p.tau != null ? `+${p.tau} h` : "—"}</td>
                  <td className="py-1.5 pr-2 text-ink">
                    <span className="inline-flex items-center gap-1.5">
                      <IntensitySwatch label={p.label} />
                      {intensityName(p.label, true) ?? "—"}
                    </span>
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap text-ink">{fmt.wind(ktToMs(p.windKt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs text-ink-3">The cone shows the probable track of the centre, not the size of the storm.</p>
        {s.advisoryUrl && (
          <a
            href={s.advisoryUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline pointer-coarse:min-h-11"
          >
            {s.advisory?.number ? `NHC advisory ${s.advisory.number}` : "NHC advisory"}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}
