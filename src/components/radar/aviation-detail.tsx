"use client";

import { ExternalLink, X } from "lucide-react";
import { useAirport } from "@/hooks/use-aviation";
import { useFormat } from "@/hooks/use-format";
import { CATEGORY_COLORS, HAZARD_COLORS, HAZARD_LABELS, KIND_LABELS, UNKNOWN_CATEGORY_COLOR, type AviationAdvisory } from "@/lib/aviation";
import {
  COVER_NAMES,
  decodeMetar,
  decodeTaf,
  formatSm,
  tafPeriodAt,
  weatherText,
  type Conditions,
  type FlightCategory,
  type TafPeriod,
  type Visibility,
  type Wind,
} from "@/lib/aviation/decode";
import type { Translator } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/use-t";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { clockIn, fmtIn } from "@/lib/weather/view";
import { buttonClass, IconButton } from "../ui/button";
import { ErrorNote } from "../ui/misc";
import { HazardSwatch } from "./alert-list";

const AWC_SITE = "https://aviationweather.gov/";

function Fact({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-sm leading-5 font-medium break-words text-ink tabular">{children}</dd>
    </div>
  );
}

function Title({ color, title, sub, onClose, closeLabel }: { color: string; title: string; sub: string; onClose?: () => void; closeLabel: string }) {
  return (
    <div className="flex items-start gap-3">
      <HazardSwatch color={color} className="mt-2" />
      <div className="min-w-0 flex-1">
        <h3 className="text-base leading-6 font-semibold break-words text-ink">{title}</h3>
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

/** A flight category as a small chip in its colour. */
export function CategoryChip({ category, className }: { category: FlightCategory | null; className?: string }) {
  const t = useT();
  const color = category ? CATEGORY_COLORS[category] : UNKNOWN_CATEGORY_COLOR;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-[4px] px-1.5 py-px font-mono text-[11px] leading-4 font-semibold text-black", className)}
      style={{ background: color }}
    >
      {category ?? t("No category")}
    </span>
  );
}

/** A report as sent, in a monospaced block. */
function Raw({ text }: { text: string }) {
  return <p className="rounded-[var(--radius-control)] bg-surface-2 px-2.5 py-2 font-mono text-[12px] leading-snug break-words whitespace-pre-line text-ink-2">{text}</p>;
}

// ── Words for the decoded groups (aviation units: kt, SM, ft) ────────────────

const ft = (n: number, t: Translator) => t("{n} ft", { n: n.toLocaleString(t.locale) });
const pad3 = (deg: number) => String(deg).padStart(3, "0");

export function windWords(w: Wind | null, t: Translator): string {
  if (!w) return "—";
  if (w.speedKt === 0 && !w.gustKt) return t("Calm");
  const parts = [w.dirDeg == null ? t("Variable at {speed} kt", { speed: w.speedKt }) : t("{deg}° at {speed} kt", { deg: pad3(w.dirDeg), speed: w.speedKt })];
  if (w.gustKt) parts.push(t("gusts {n} kt", { n: w.gustKt }));
  if (w.varFromDeg != null && w.varToDeg != null) parts.push(t("varying {from}°–{to}°", { from: pad3(w.varFromDeg), to: pad3(w.varToDeg) }));
  return parts.join(", ");
}

export function visibilityWords(v: Visibility | null, t: Translator): string {
  if (!v) return "—";
  if (v.meters != null) {
    if (v.plus) return t("10 km or more");
    return v.meters >= 5000 ? `${v.meters / 1000} km` : `${v.meters.toLocaleString(t.locale)} m`;
  }
  const n = formatSm(v.sm);
  return v.plus ? t("More than {n} SM", { n }) : v.minus ? t("Less than {n} SM", { n }) : t("{n} SM", { n });
}

function cloudWords(c: Pick<Conditions, "clouds" | "skyClear" | "cavok">, t: Translator): string {
  if (!c.clouds.length) return c.cavok ? "CAVOK" : c.skyClear ? t("Clear") : "—";
  return c.clouds
    .map((l) => [t(COVER_NAMES[l.cover]), l.baseFt != null ? ft(l.baseFt, t) : "—", l.type === "CB" ? t("cumulonimbus") : l.type === "TCU" ? t("towering cumulus") : ""].filter(Boolean).join(" "))
    .join(", ");
}

const weatherWords = (c: Pick<Conditions, "weather">, t: Translator) => c.weather.map((w) => weatherText(w, t)).join(", ");

/** "Tue 3:00 PM": TAF times run over a day, so they carry the weekday. */
function dayClock(zone: string | undefined, ms: number, locale: string): string {
  try {
    return fmtIn(zone, { weekday: "short", hour: "numeric", minute: "2-digit" }, locale).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(11, 16) + "Z";
  }
}

const CHANGE_LABEL: Record<TafPeriod["change"], string> = {
  base: "Forecast",
  from: "From",
  becoming: "Becoming",
  temporary: "Temporarily",
  probability: "{n}% chance",
};

function periodLabel(p: TafPeriod, t: Translator): string {
  if (p.change === "probability") return t(p.temporary ? "{n}% chance, temporarily" : "{n}% chance", { n: p.probability ?? 0 });
  return t(CHANGE_LABEL[p.change]);
}

function periodWords(p: TafPeriod, t: Translator): string {
  return [
    p.wind && windWords(p.wind, t),
    p.visibility && visibilityWords(p.visibility, t),
    p.weather.length ? weatherWords(p, t) : p.noSignificantWeather ? t("No significant weather") : null,
    (p.clouds.length || p.skyClear) && cloudWords(p, t),
    p.windShear &&
      t("Wind shear at {height}: {wind}", { height: ft(p.windShear.heightFt, t), wind: t("{deg}° at {speed} kt", { deg: pad3(p.windShear.dirDeg), speed: p.windShear.speedKt }) }),
  ]
    .filter(Boolean)
    .join(" · ");
}

// ── Airport ──────────────────────────────────────────────────────────────────

/** An airport tapped on the map: its latest METAR decoded, and its TAF (raw and period by period). */
export function AirportDetail({
  id,
  now,
  timeZone,
  onClose,
  hideTitle = false,
  className,
}: {
  id: string;
  now: number;
  timeZone: string | undefined;
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const t = useT();
  const fmt = useFormat();
  const q = useAirport(id);
  const a = q.data;
  // Report days are placed in a month by a time near them: their own, else when they were fetched.
  const fetched = a ? Date.parse(a.updated) : now;
  const metar = a?.metar ? decodeMetar(a.metar.raw, a.metar.time ? Date.parse(a.metar.time) : fetched) : null;
  const taf = a?.taf ? decodeTaf(a.taf.raw, a.taf.issued ? Date.parse(a.taf.issued) : fetched) : null;
  const obsTime = metar?.time ?? (a?.metar?.time ? Date.parse(a.metar.time) : null);
  const category = metar?.category ?? null;
  const current = taf ? tafPeriodAt(taf, now) : undefined;

  const sub = [
    a?.name,
    obsTime != null ? t("Observed {time}, {ago}", { time: clockIn(timeZone, obsTime, t.locale), ago: timeAgo(obsTime, now, t) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {!hideTitle && (
        <Title color={category ? CATEGORY_COLORS[category] : UNKNOWN_CATEGORY_COLOR} title={id} sub={sub || t("Airport weather")} onClose={onClose} closeLabel={t("Close airport")} />
      )}
      {hideTitle && sub && <p className="text-xs text-ink-3 tabular">{sub}</p>}

      {q.error ? <ErrorNote error={q.error} what="the airport's reports" /> : null}
      {q.isLoading && <p className="text-xs text-ink-3">{t("Loading the latest reports")}</p>}

      {a && !a.metar && <p className="text-xs text-ink-3">{t("No recent METAR from this airport.")}</p>}
      {a?.metar && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-semibold text-ink">METAR</h4>
            <CategoryChip category={category} />
          </div>
          {metar && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label={t("Wind")}>{windWords(metar.wind, t)}</Fact>
              <Fact label={t("Visibility")}>{visibilityWords(metar.visibility, t)}</Fact>
              <Fact label={t("Ceiling")}>{metar.ceilingFt != null ? ft(metar.ceilingFt, t) : metar.clouds.length || metar.skyClear ? t("None") : "—"}</Fact>
              <Fact label={t("Altimeter")}>
                {metar.altimeter ? (metar.altimeter.unit === "inHg" ? `${metar.altimeter.value.toFixed(2)} inHg` : `${metar.altimeter.value} hPa`) : "—"}
              </Fact>
              <Fact label={t("Temperature / dew point")}>
                {fmt.temp(metar.tempC, true)} / {fmt.temp(metar.dewpointC, true)}
              </Fact>
              {metar.weather.length > 0 && <Fact label={t("Present weather")}>{weatherWords(metar, t)}</Fact>}
              <Fact label={t("Clouds")} wide>
                {cloudWords(metar, t)}
              </Fact>
            </dl>
          )}
          <Raw text={a.metar.raw} />
        </section>
      )}

      {a?.taf && (
        <section className="space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 className="text-[13px] font-semibold text-ink">TAF{taf?.amended ? ` ${t("(amended)")}` : ""}</h4>
            {taf && (
              <span className="text-xs text-ink-3 tabular">
                {t("Valid {from} to {to}", { from: dayClock(timeZone, taf.from, t.locale), to: dayClock(timeZone, taf.to, t.locale) })}
              </span>
            )}
          </div>
          {taf && (
            <ol className="space-y-2">
              {taf.periods.map((p, i) => (
                <li key={i} className={cn("rounded-[var(--radius-control)] border border-line px-2.5 py-2", p === current && "border-accent/60 bg-surface-2")}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-xs text-ink-2 tabular">
                      <span className="font-semibold text-ink">{periodLabel(p, t)}</span> {dayClock(timeZone, p.from, t.locale)} – {dayClock(timeZone, p.to, t.locale)}
                    </span>
                    <CategoryChip category={p.category} />
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-ink-2">{periodWords(p, t) || "—"}</p>
                </li>
              ))}
            </ol>
          )}
          <Raw text={a.taf.raw} />
        </section>
      )}
      {a && a.metar && !a.taf && <p className="text-xs text-ink-3">{t("This airport doesn't issue a TAF.")}</p>}

      <Footer />
    </div>
  );
}

function Footer() {
  const t = useT();
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="label">{t("From the NOAA Aviation Weather Center. For situational awareness, not a weather briefing.")}</p>
      <a href={AWC_SITE} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
        <ExternalLink className="size-4" aria-hidden />
        aviationweather.gov
      </a>
    </div>
  );
}

// ── SIGMET / AIRMET ──────────────────────────────────────────────────────────

const altitude = (n: number, t: Translator) => (n === 0 ? t("Surface") : n >= 18_000 ? `FL${Math.round(n / 100)}` : ft(n, t));

function altitudes(a: Pick<AviationAdvisory, "baseFt" | "topFt">, t: Translator): string | null {
  if (a.baseFt != null && a.topFt != null) return t("{base} to {top}", { base: altitude(a.baseFt, t), top: altitude(a.topFt, t) });
  if (a.topFt != null) return t("Up to {top}", { top: altitude(a.topFt, t) });
  if (a.baseFt != null) return t("Above {base}", { base: altitude(a.baseFt, t) });
  return null;
}

/** Title of an advisory: "Convective SIGMET · Thunderstorms". */
export const advisoryTitle = (a: Pick<AviationAdvisory, "kind" | "hazard">, t: Translator) => `${t(KIND_LABELS[a.kind])} · ${t(HAZARD_LABELS[a.hazard])}`;

/** A SIGMET or AIRMET tapped on the map: its hazard, times, altitudes and text. */
export function AdvisoryDetail({
  advisory: a,
  now,
  timeZone,
  onClose,
  hideTitle = false,
  className,
}: {
  advisory: AviationAdvisory;
  now: number;
  timeZone: string | undefined;
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const t = useT();
  const from = Date.parse(a.from);
  const to = Date.parse(a.to);
  const when =
    a.kind === "gairmet"
      ? t("Snapshot for {time}", { time: dayClock(timeZone, from, t.locale) })
      : t("Valid {from} to {to}", { from: dayClock(timeZone, from, t.locale), to: dayClock(timeZone, to, t.locale) });
  const levels = altitudes(a, t);
  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {!hideTitle && <Title color={HAZARD_COLORS[a.hazard]} title={advisoryTitle(a, t)} sub={when} onClose={onClose} closeLabel={t("Close advisory")} />}
      {hideTitle && <p className="text-xs text-ink-3 tabular">{when}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label={t("Hazard")}>{t(HAZARD_LABELS[a.hazard])}</Fact>
        {levels && <Fact label={t("Altitudes")}>{levels}</Fact>}
        <Fact label={t("Ends")} wide>
          {to > now ? `${dayClock(timeZone, to, t.locale)}, ${timeAgo(to, now, t)}` : t("Ended")}
        </Fact>
      </dl>
      {a.text && <Raw text={a.text} />}
      {a.kind === "gairmet" && <p className="label">{t("G-AIRMETs are snapshots every 3 hours; this is the one nearest now.")}</p>}
      <Footer />
    </div>
  );
}
