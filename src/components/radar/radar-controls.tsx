"use client";

import { familiesAvailable, FAMILIES, FAMILY_ORDER, resolveTilts, type ProductFamily, type TiltPrefix } from "@/lib/radar/products";
import { nearestSites, type RadarSite } from "@/lib/radar/site-utils";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { RadarSettings } from "@/store/app-store";
import { Toggle } from "../ui/misc";
import { Segmented } from "../ui/segmented";
import { sentenceCase } from "./radar-legend";

const INPUT =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink outline-none focus:border-accent pointer-coarse:h-11";

function Field({ label, htmlFor, aside, children }: { label: string; htmlFor?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  const Tag = htmlFor ? "label" : "p";
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <Tag htmlFor={htmlFor} className="label">
          {label}
        </Tag>
        {aside && <span className="label tabular">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

export function RadarControls({
  settings,
  onChange,
  site,
  available,
  location,
}: {
  settings: RadarSettings;
  onChange: (r: Partial<RadarSettings>) => void;
  site: RadarSite | null;
  available: ReadonlySet<string> | null;
  location: { lat: number; lon: number };
}) {
  const fmt = useFormat();
  const t = useT();
  const isSite = settings.source === "site";
  const families = isSite ? familiesAvailable(available) : (["reflectivity"] as ProductFamily[]);
  const tilts = isSite ? resolveTilts(settings.family, available) : [];
  const nearby = nearestSites(location, 6);
  const activeFamily = isSite ? settings.family : "reflectivity";

  return (
    <div className="space-y-5 text-sm">
      <Group title={t("Radar")}>
        <Field label={t("Source")}>
          <Segmented
            ariaLabel={t("Radar source")}
            stretch
            value={settings.source}
            onChange={(source) => onChange({ source, ...(source === "mosaic" ? { family: "reflectivity" as const } : {}) })}
            options={[
              { value: "mosaic", label: t("National mosaic") },
              { value: "site", label: t("Single site") },
            ]}
          />
        </Field>

        {isSite && (
          <Field label={t("Radar site")} htmlFor="radar-site">
            <select
              id="radar-site"
              aria-describedby="radar-site-hint"
              value={site?.icao ?? ""}
              onChange={(e) => onChange({ site: e.target.value || null })}
              className={INPUT}
            >
              <option value="">{t("Nearest to location")}</option>
              {nearby.map((s) => (
                <option key={s.icao} value={s.icao}>
                  {s.icao} — {s.place}, {s.state} ({fmt.distanceKm(s.distanceKm)})
                </option>
              ))}
              {site && !nearby.some((n) => n.icao === site.icao) && (
                <option value={site.icao}>
                  {site.icao} — {site.place}, {site.state}
                </option>
              )}
            </select>
            <p id="radar-site-hint" className="label mt-1.5">
              {t("You can also select a site on the map.")}
            </p>
          </Field>
        )}

        <Field label={t("Product")} aside={sentenceCase(t(FAMILIES[activeFamily].label))}>
          <div className="grid grid-cols-3 gap-0.5 rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5">
            {FAMILY_ORDER.map((fam) => {
              const enabled = families.includes(fam);
              const active = activeFamily === fam;
              return (
                <button
                  key={fam}
                  type="button"
                  title={sentenceCase(t(FAMILIES[fam].label))}
                  aria-pressed={active}
                  onClick={() => onChange(isSite ? { family: fam } : { source: "site", family: fam })}
                  disabled={isSite && !enabled}
                  className={cn(
                    "h-8 rounded-[4px] border font-mono text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-35 pointer-coarse:h-11",
                    active ? "border-line-strong bg-surface-3 text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  {FAMILIES[fam].short}
                </button>
              );
            })}
          </div>
          {!isSite && <p className="label mt-1.5">{t("Velocity and dual-pol products switch to single-site data.")}</p>}
        </Field>

        {isSite && tilts.length > 0 && (
          <Field label={t("Elevation tilt")}>
            <Segmented
              ariaLabel={t("Elevation tilt")}
              size="sm"
              stretch
              value={tilts.some((x) => x.prefix === settings.tilt) ? settings.tilt : tilts[0]!.prefix}
              onChange={(tilt: TiltPrefix) => onChange({ tilt })}
              options={tilts.map((x) => ({ value: x.prefix, label: <span className="tabular">{x.angle}°</span>, title: x.code }))}
            />
          </Field>
        )}
      </Group>

      <Group title={t("Display")}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Field label={t("Frames")} htmlFor="radar-frames">
            <select id="radar-frames" value={settings.frames} onChange={(e) => onChange({ frames: Number(e.target.value) })} className={INPUT}>
              {[6, 12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {t("{n} frames", { n })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Opacity")} htmlFor="radar-opacity" aside={`${Math.round(settings.opacity * 100)}%`}>
            <input
              id="radar-opacity"
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={settings.opacity}
              onChange={(e) => onChange({ opacity: Number(e.target.value) })}
              className="block h-9 w-full accent-[var(--color-accent)] pointer-coarse:h-11"
            />
          </Field>
        </div>
        <Field label={t("Loop history")}>
          <Segmented
            ariaLabel={t("Loop history")}
            size="sm"
            stretch
            value={settings.history}
            onChange={(history) => onChange({ history })}
            options={[
              { value: "latest", label: t("Latest scans") },
              { value: "2h", label: t("2 hours") },
              { value: "4h", label: t("4 hours") },
            ]}
          />
          <p className="label mt-1.5">{t("Longer histories spread the same number of frames over more time, to see how storms evolved.")}</p>
        </Field>
        <div>
          <Toggle label={t("Smoothed radar")} checked={settings.smooth} onChange={(smooth) => onChange({ smooth })} />
          <p className="label">{t("Blends pixels when zoomed in for a cleaner picture. Velocity and dual-pol stay sharp.")}</p>
        </div>
        <Toggle label={t("Smooth cross-fade")} checked={settings.crossfade} onChange={(crossfade) => onChange({ crossfade })} />
        <div>
          <Toggle label={t("Future radar (next 6 hours)")} checked={settings.future} onChange={(future) => onChange({ future })} />
          <p className="label">{isSite ? t("Shown with the national mosaic only.") : t("HRRR model forecast after the live scans, marked in orange on the timeline.")}</p>
        </div>
        <Field label={t("GOES satellite")}>
          <Segmented
            ariaLabel={t("Satellite imagery")}
            size="sm"
            stretch
            value={settings.satellite}
            onChange={(satellite) => onChange({ satellite })}
            options={[
              { value: "off", label: t("Off") },
              { value: "infrared", label: t("Infrared") },
              { value: "visible", label: t("Visible") },
            ]}
          />
          {settings.satellite === "visible" && <p className="label mt-1.5">{t("Visible imagery is dark at night; infrared works around the clock.")}</p>}
        </Field>
      </Group>

      <Group title={t("Overlays")}>
        <div className="-mt-1 divide-y divide-line">
          <Toggle label={t("NWS warnings")} checked={settings.showWarnings} onChange={(showWarnings) => onChange({ showWarnings })} />
          <Toggle label={t("Projected storm tracks")} checked={settings.showTracks} onChange={(showTracks) => onChange({ showTracks })} />
          <Toggle label={t("Lightning (last 15 min)")} checked={settings.showLightning} onChange={(showLightning) => onChange({ showLightning })} />
          <Toggle label={t("Radar storm cells")} checked={settings.showCells} onChange={(showCells) => onChange({ showCells })} />
          <Toggle label={t("NWS storm reports")} checked={settings.showStormReports} onChange={(showStormReports) => onChange({ showStormReports })} />
          <Toggle label={t("Hurricanes and tropical storms")} checked={settings.showTropical} onChange={(showTropical) => onChange({ showTropical })} />
          <Toggle label={t("SPC Day 1 outlook")} checked={settings.showOutlook} onChange={(showOutlook) => onChange({ showOutlook })} />
          {settings.showOutlook && (
            <div className="py-2.5">
              <Segmented
                ariaLabel={t("Outlook hazard")}
                size="sm"
                stretch
                value={settings.outlookKind}
                onChange={(outlookKind) => onChange({ outlookKind })}
                options={[
                  { value: "categorical", label: t("Risk") },
                  { value: "tornado", label: t("Tornado") },
                  { value: "hail", label: t("Hail") },
                  { value: "wind", label: t("Wind") },
                ]}
              />
            </div>
          )}
          {COMMUNITY_ENABLED && (
            <Toggle label={t("Spotter reports (6 h)")} checked={settings.showReports} onChange={(showReports) => onChange({ showReports })} />
          )}
          <Toggle label={t("Radar sites")} checked={settings.showSites} onChange={(showSites) => onChange({ showSites })} />
        </div>
      </Group>
    </div>
  );
}
