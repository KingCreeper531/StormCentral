"use client";

import { X } from "lucide-react";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import type { StormCell } from "@/lib/feeds/storm-cells";
import {
  cellEta,
  cellHeading,
  cellSeverity,
  placeName,
  REPORT_GROUPS,
  reportGroup,
  reportMagnitude,
  reportTitle,
  sourceLabel,
  type ReportGroup,
} from "@/lib/feeds/storm-parse";
import type { StormReport } from "@/lib/feeds/storm-reports";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { clockIn } from "@/lib/weather/view";
import { CELL_COLORS, CELL_LEVEL_LABEL } from "../map/layers/storm-cells-layer";
import { REPORT_COLORS, REPORT_GROUP_COLORS } from "../map/layers/storm-reports-layer";
import { IconButton } from "../ui/button";
import { EmptyState } from "../ui/misc";
import { HazardSwatch } from "./alert-list";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) / 45) % 8]!;
const KT_TO_MS = 0.514444;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const GROUP_LABEL: Record<ReportGroup, string> = { tornado: "Tornado", hail: "Hail", wind: "Wind", flood: "Flood", other: "Other" };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-lg leading-6 font-medium break-words text-ink tabular">{children}</dd>
    </div>
  );
}

function Title({ color, title, sub, onClose, closeLabel }: { color: string; title: string; sub: string; onClose?: () => void; closeLabel: string }) {
  return (
    <div className="flex items-start gap-3">
      <HazardSwatch color={color} className="mt-2" />
      <div className="min-w-0 flex-1">
        <h3 className="text-base leading-6 font-semibold text-ink">{title}</h3>
        <p className="text-xs text-ink-3 tabular">{sub}</p>
      </div>
      {onClose && (
        <IconButton label={closeLabel} size="sm" onClick={onClose} className="-mt-1 -mr-2">
          <X className="size-4" aria-hidden />
        </IconButton>
      )}
    </div>
  );
}

function useMagnitude() {
  const fmt = useFormat();
  return (r: StormReport): string | null => {
    const m = reportMagnitude(r);
    if (!m) return null;
    if (m.kind === "length") return fmt.precip(m.mm);
    if (m.kind === "speed") return fmt.wind(m.ms);
    if (m.kind === "rating") return m.text;
    return `${m.value}${m.unit ? ` ${m.unit.toLowerCase()}` : ""}`;
  };
}

/** One NWS local storm report. Unstyled container, like `AlertDetail`. */
export function StormReportDetail({
  report: r,
  now,
  timeZone,
  onClose,
  hideTitle = false,
  className,
}: {
  report: StormReport;
  now: number;
  timeZone: string | undefined;
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const t = useT();
  const magnitude = useMagnitude()(r);
  const where = [placeName(r.place), r.county ? t("{county} County", { county: placeName(r.county) }) : null, r.state].filter(Boolean).join(", ");
  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {!hideTitle && (
        <Title
          color={REPORT_COLORS[r.kind]}
          title={t(reportTitle(r.typeText))}
          sub={`${clockIn(timeZone, r.time, t.locale)}, ${timeAgo(Date.parse(r.time), now, t)}`}
          onClose={onClose}
          closeLabel={t("Close report")}
        />
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {magnitude && <Fact label={r.measured ? t("Measured") : r.measured === false ? t("Estimated") : t("Magnitude")}>{magnitude}</Fact>}
        <Fact label={t("Time")}>{clockIn(timeZone, r.time, t.locale)}</Fact>
        <div className="col-span-2">
          <Fact label={t("Location")}>{where || "—"}</Fact>
        </div>
        {r.source && <Fact label={t("Source")}>{t(sourceLabel(r.source))}</Fact>}
        {r.wfo && <Fact label={t("NWS office")}>{r.wfo}</Fact>}
      </dl>
      {r.remark && <p className="text-sm leading-6 text-ink-2">{r.remark}</p>}
      <p className="label">{t("Preliminary NWS local storm report via Iowa Environmental Mesonet")}</p>
    </div>
  );
}

/** One NEXRAD storm cell: signatures, hail, motion and arrival at the selected location. */
export function StormCellDetail({
  cell: c,
  now,
  timeZone,
  location,
  onClose,
  hideTitle = false,
  className,
}: {
  cell: StormCell;
  now: number;
  timeZone: string | undefined;
  location: { lat: number; lon: number; name: string };
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const fmt = useFormat();
  const t = useT();
  const level = cellSeverity(c);
  const eta = cellEta(c, location, { now });
  // The minutes are bold: split the sentence around them.
  const reach = t("Reaches {place} in about {eta} if it holds its course.", { place: location.name }).split("{eta}");
  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {!hideTitle && (
        <Title
          color={CELL_COLORS[level]}
          title={t(CELL_LEVEL_LABEL[level])}
          sub={t("Cell {id} on {radar}, scan {time}", { id: c.stormId, radar: c.radar, time: clockIn(timeZone, c.time, t.locale) })}
          onClose={onClose}
          closeLabel={t("Close storm cell")}
        />
      )}
      {eta != null && (
        <p className="rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink">
          {reach[0]}
          <span className="font-semibold tabular">{Math.max(1, Math.round(eta))} min</span>
          {reach[1]}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label={t("Max hail")}>{c.maxHailIn != null && c.maxHailIn > 0 ? fmt.precip(c.maxHailIn * 25.4) : "—"}</Fact>
        <Fact label={t("Severe hail chance")}>{c.severeHailProb != null ? `${c.severeHailProb}%` : "—"}</Fact>
        <Fact label={t("Rotation")}>{c.tvs ?? (c.meso != null ? t("Meso, rank {n}", { n: c.meso }) : sentence(t("none")))}</Fact>
        <Fact label={t("Moving")}>{c.motion && c.motion.speedKt >= 1 ? `${t(compass(cellHeading(c.motion)))} ${fmt.wind(c.motion.speedKt * KT_TO_MS)}` : t("Stationary")}</Fact>
        <Fact label={t("Max reflectivity")}>{c.maxDbz != null ? `${Math.round(c.maxDbz)} dBZ` : "—"}</Fact>
        <Fact label={t("Echo top")}>{c.topKft != null ? fmt.height(c.topKft * 304.8) : "—"}</Fact>
        <Fact label={t("VIL")}>{c.vil != null ? `${Math.round(c.vil)} kg/m²` : "—"}</Fact>
        <Fact label={t("Hail chance")}>{c.hailProb != null ? `${c.hailProb}%` : "—"}</Fact>
      </dl>
      <p className="label">{t("Radar storm-cell algorithms (SCIT, HDA, MDA, TDA). Automated, unverified signals.")}</p>
    </div>
  );
}

/** Report counts by kind and the newest reports. */
export function StormReportsList({
  reports,
  hours,
  now,
  timeZone,
  selectedId,
  onSelect,
}: {
  reports: StormReport[];
  hours: number;
  now: number;
  timeZone: string | undefined;
  selectedId: string | null;
  onSelect: (r: StormReport) => void;
}) {
  const t = useT();
  const magnitude = useMagnitude();
  if (!reports.length) {
    return <EmptyState title={t("No storm reports")}>{t.plural(hours, "No NWS local storm reports in the last hour.", "No NWS local storm reports in the last {n} hours.")}</EmptyState>;
  }
  const counts = new Map<ReportGroup, number>();
  for (const r of reports) counts.set(reportGroup(r.kind), (counts.get(reportGroup(r.kind)) ?? 0) + 1);
  const newest = [...reports].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 40);
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3">
        {REPORT_GROUPS.filter((g) => counts.get(g)).map((g) => (
          <span key={g} className="flex items-center gap-1.5 text-xs text-ink-2 tabular">
            <span className="size-2 rounded-full" style={{ background: REPORT_GROUP_COLORS[g] }} aria-hidden />
            {t(GROUP_LABEL[g])} {counts.get(g)}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {newest.map((r) => {
          const m = magnitude(r);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                aria-current={selectedId === r.id || undefined}
                className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2", selectedId === r.id && "bg-surface-2")}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: REPORT_COLORS[r.kind] }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {t(reportTitle(r.typeText))}
                    {m && <span className="text-ink-2"> · {m}</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {[placeName(r.place), r.state].filter(Boolean).join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink-3 tabular" title={clockIn(timeZone, r.time, t.locale)}>
                  {timeAgo(Date.parse(r.time), now, t)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {reports.length > newest.length && (
        <p className="label border-t border-line px-4 py-3">{t("Newest {n} of {total}; all are on the map.", { n: newest.length, total: reports.length })}</p>
      )}
    </div>
  );
}

/** The strongest radar cells, those heading for the location first. */
export function StormCellList({
  cells,
  now,
  location,
  selectedId,
  onSelect,
}: {
  cells: StormCell[];
  now: number;
  location: { lat: number; lon: number };
  selectedId: string | null;
  onSelect: (c: StormCell) => void;
}) {
  const fmt = useFormat();
  const t = useT();
  const top = cells
    .map((c) => ({ c, level: cellSeverity(c), eta: cellEta(c, location, { now }) }))
    .filter((x) => x.level >= 2 || x.eta != null)
    .sort((a, b) => Number(b.eta != null) - Number(a.eta != null) || b.level - a.level || (a.eta ?? 0) - (b.eta ?? 0))
    .slice(0, 12);
  if (!top.length) return <p className="px-4 py-3 text-xs text-ink-3">{t("No radar cells with rotation or severe hail right now.")}</p>;
  return (
    <ul className="divide-y divide-line">
      {top.map(({ c, level, eta }) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c)}
            aria-current={selectedId === c.id || undefined}
            className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2", selectedId === c.id && "bg-surface-2")}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: CELL_COLORS[level] }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{t(CELL_LEVEL_LABEL[level])}</span>
              <span className="block truncate text-xs text-ink-3 tabular">
                {c.radar} {c.stormId}
                {c.maxHailIn ? ` · ${t("hail {size}", { size: fmt.precip(c.maxHailIn * 25.4) })}` : ""}
              </span>
            </span>
            {eta != null && <span className="shrink-0 text-xs font-medium text-ink tabular">{Math.max(1, Math.round(eta))} min</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
