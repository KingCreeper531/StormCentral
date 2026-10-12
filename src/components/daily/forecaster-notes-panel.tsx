"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useForecasterNotes } from "@/hooks/queries";
import type { AfdSection } from "@/lib/afd";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { buttonClass } from "../ui/button";
import { Skeleton } from "../ui/misc";
import { Panel } from "../ui/panel";

const SUMMARY_LABEL = { "key-messages": "Key messages", synopsis: "The big picture", discussion: "Latest thinking" } as const;

/** A collapsible block: native details, so it works without JS and with the keyboard. */
function Disclosure({ summary, children, className }: { summary: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <details className={cn("group border-t border-line", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2.5 text-[13px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

function Section({ s }: { s: AfdSection }) {
  return (
    <section className="mt-3 first:mt-0">
      <h3 className="text-[13px] font-semibold text-ink">
        {s.title}
        {s.period && <span className="font-normal text-ink-3"> · {s.period}</span>}
      </h3>
      {s.paragraphs.map((p, i) => (
        <p key={i} className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          {p}
        </p>
      ))}
    </section>
  );
}

/**
 * The local NWS forecasters' own discussion (Area Forecast Discussion):
 * their key messages up front, the full reasoning and a jargon decoder
 * folded away. US only; renders nothing elsewhere.
 */
export function ForecasterNotesPanel({ now, className }: { now: number; className?: string }) {
  const q = useForecasterNotes();
  const d = q.data;
  if (q.isError && !d) return null;
  if (!d)
    return (
      <Panel title="Forecaster notes" subtitle="National Weather Service" aria-busy="true" className={className}>
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="mt-2 h-4 w-4/5" />
        <Skeleton className="mt-2 h-4 w-3/5" />
      </Panel>
    );

  const forecast = d.sections.filter((s) => !s.specialty);
  const specialty = d.sections.filter((s) => s.specialty);
  const issued = Date.parse(d.issued);

  return (
    <Panel
      title="Forecaster notes"
      subtitle={`NWS ${d.officeName ?? d.office}${Number.isFinite(issued) ? `, ${timeAgo(issued, now)}` : ""}`}
      className={className}
      action={
        <a href={d.url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
          Original
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      }
    >
      {d.summary && (
        <>
          <p className="label">{SUMMARY_LABEL[d.summary.kind]}</p>
          <ul className="mt-1.5 space-y-2">
            {d.summary.items.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.changes.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          <span className="font-medium text-ink-2">What&apos;s changed: </span>
          {d.changes.join(" ")}
        </p>
      )}

      <div className="mt-3">
        {forecast.length > 0 && (
          <Disclosure summary="Read the full discussion">
            {forecast.map((s) => (
              <Section key={s.id} s={s} />
            ))}
          </Disclosure>
        )}
        {specialty.length > 0 && (
          <Disclosure summary={<span className="truncate">More: {specialty.map((s) => s.title).join(", ")}</span>}>
            {specialty.map((s) => (
              <Section key={s.id} s={s} />
            ))}
          </Disclosure>
        )}
        {d.glossary.length > 0 && (
          <Disclosure summary={`Jargon decoder (${d.glossary.length} terms)`}>
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
              {d.glossary.map((g) => (
                <div key={g.term} className="contents">
                  <dt className="text-[13px] font-medium text-ink">{g.term}</dt>
                  <dd className="text-[13px] leading-relaxed text-ink-2">{g.meaning}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
        )}
      </div>
    </Panel>
  );
}
