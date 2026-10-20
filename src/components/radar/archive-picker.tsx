"use client";

import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { useState } from "react";
import { useNow } from "@/hooks/use-now";
import { useT } from "@/lib/i18n/use-t";
import { zoneFor } from "@/lib/clock";
import { ARCHIVE_EVENTS, ARCHIVE_START, archiveTime, fromWallTime, toWallTime, type ArchiveEvent } from "@/lib/radar/archive";
import { fmtIn } from "@/lib/weather/view";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { Button, IconButton } from "../ui/button";

const INPUT =
  "h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2.5 text-sm text-ink outline-none focus:border-accent pointer-coarse:h-11";

/** "May 20, 2013, 3:00 PM CDT": an archive time, always with its date and zone. */
export function archiveLabel(at: number, timeZone: string | undefined, locale?: string): string {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return fmtIn(timeZone, opts, locale).format(at);
  } catch {
    return fmtIn(undefined, opts, locale).format(at);
  }
}

/** Move the archive time by `ms`; past now, back to live. */
function shiftArchive(ms: number) {
  const { archiveAt, setArchiveAt } = useAppStore.getState();
  if (archiveAt == null) return;
  const next = archiveAt + ms;
  setArchiveAt(next >= Date.now() ? null : Math.max(ARCHIVE_START, next));
}

/**
 * Pick a past time to look at: a date and time (read in the location's zone,
 * like every other time on screen), or one of the storms worth seeing again.
 * `onEvent` frames the storm on the map.
 */
export function ArchivePicker({ timeZone, onEvent, className }: { timeZone?: string; onEvent?: (e: ArchiveEvent) => void; className?: string }) {
  const t = useT();
  const archiveAt = useAppStore((s) => s.archiveAt);
  const setArchiveAt = useAppStore((s) => s.setArchiveAt);
  const zone = zoneFor(timeZone);
  const now = useNow(60_000);
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const value = draft ?? (archiveAt != null ? toWallTime(archiveAt, zone) : "");
  const event = ARCHIVE_EVENTS.find((e) => archiveTime(e.at) === archiveAt);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const at = archiveTime(fromWallTime(value, zone));
    setBad(at == null);
    if (at == null) return;
    setDraft(null);
    setArchiveAt(at);
  };

  return (
    <div className={cn("space-y-3 text-sm", className)}>
      <form onSubmit={submit} className="space-y-1.5">
        <label htmlFor="archive-time" className="label block">
          {t("Date and time")}
        </label>
        <div className="flex gap-2">
          <input
            id="archive-time"
            type="datetime-local"
            className={INPUT}
            min={toWallTime(ARCHIVE_START, zone)}
            max={toWallTime(now, zone)}
            value={value}
            onChange={(e) => {
              setDraft(e.target.value);
              setBad(false);
            }}
            aria-invalid={bad || undefined}
          />
          <Button type="submit" disabled={!value}>
            {t("Show")}
          </Button>
        </div>
        {bad && <p className="text-xs text-nogo">{t("Pick a time from 1995 to now.")}</p>}
      </form>

      <div className="space-y-1.5">
        <label htmlFor="archive-event" className="label block">
          {t("Notable storms")}
        </label>
        <select
          id="archive-event"
          className={INPUT}
          value={event?.id ?? ""}
          onChange={(e) => {
            const ev = ARCHIVE_EVENTS.find((x) => x.id === e.target.value);
            if (!ev) return;
            setDraft(null);
            setBad(false);
            setArchiveAt(archiveTime(ev.at));
            onEvent?.(ev);
          }}
        >
          <option value="">{t("Choose a storm")}</option>
          {ARCHIVE_EVENTS.map((e) => (
            <option key={e.id} value={e.id}>
              {t(e.name)}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-ink-3">
        {t("The national mosaic and warnings go back to 1995, storm reports to the mid-2000s. Professional mode adds each radar's own scans: Level II from 1995, Level III from 2020.")}
      </p>
      {archiveAt != null && (
        <Button
          variant="primary"
          className="w-full"
          onClick={() => {
            setDraft(null);
            setArchiveAt(null);
          }}
        >
          {t("Back to live")}
        </Button>
      )}
    </div>
  );
}

/** While looking back: when, an hour either way, and the way back to live. */
export function ArchiveStrip({
  timeZone,
  onPick,
  variant = "overlay",
  className,
}: {
  timeZone?: string;
  onPick?: () => void;
  /** "inline": in a toolbar rather than over the map. */
  variant?: "overlay" | "inline";
  className?: string;
}) {
  const t = useT();
  const archiveAt = useAppStore((s) => s.archiveAt);
  const setArchiveAt = useAppStore((s) => s.setArchiveAt);
  if (archiveAt == null) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-1 py-1 pr-1 pl-2.5 text-xs",
        variant === "overlay" ? "overlay" : "rounded-[var(--radius-control)] border border-line bg-surface-2 py-0.5",
        className,
      )}
    >
      <History className="size-3.5 shrink-0 text-accent" aria-hidden />
      <button type="button" onClick={onPick} className="min-w-0 truncate px-1 text-left font-medium text-ink tabular hover:underline" title={t("Pick another time")}>
        {archiveLabel(archiveAt, timeZone, t.locale)}
      </button>
      <IconButton size="sm" label={t("An hour earlier")} onClick={() => shiftArchive(-3_600_000)} disabled={archiveAt <= ARCHIVE_START}>
        <ChevronLeft className="size-4" aria-hidden />
      </IconButton>
      <IconButton size="sm" label={t("An hour later")} onClick={() => shiftArchive(3_600_000)}>
        <ChevronRight className="size-4" aria-hidden />
      </IconButton>
      <Button size="sm" variant="primary" className="ml-auto" onClick={() => setArchiveAt(null)}>
        {t("Live")}
      </Button>
    </div>
  );
}
