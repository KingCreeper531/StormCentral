"use client";

import { familiesAvailable, FAMILIES, FAMILY_ORDER, resolveTilts, type ProductFamily, type TiltPrefix } from "@/lib/radar/products";
import { nearestSites, type RadarSite } from "@/lib/radar/site-utils";
import { useFormat } from "@/hooks/use-format";
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
  const isSite = settings.source === "site";
  const families = isSite ? familiesAvailable(available) : (["reflectivity"] as ProductFamily[]);
  const tilts = isSite ? resolveTilts(settings.family, available) : [];
  const nearby = nearestSites(location, 6);
  const activeFamily = isSite ? settings.family : "reflectivity";

  return (
    <div className="space-y-5 text-sm">
      <Group title="Radar">
        <Field label="Source">
          <Segmented
            ariaLabel="Radar source"
            stretch
            value={settings.source}
            onChange={(source) => onChange({ source, ...(source === "mosaic" ? { family: "reflectivity" as const } : {}) })}
            options={[
              { value: "mosaic", label: "National mosaic" },
              { value: "site", label: "Single site" },
            ]}
          />
        </Field>

        {isSite && (
          <Field label="Radar site" htmlFor="radar-site">
            <select
              id="radar-site"
              aria-describedby="radar-site-hint"
              value={site?.icao ?? ""}
              onChange={(e) => onChange({ site: e.target.value || null })}
              className={INPUT}
            >
              <option value="">Nearest to location</option>
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
              You can also select a site on the map.
            </p>
          </Field>
        )}

        <Field label="Product" aside={sentenceCase(FAMILIES[activeFamily].label)}>
          <div className="grid grid-cols-3 gap-0.5 rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5">
            {FAMILY_ORDER.map((fam) => {
              const enabled = families.includes(fam);
              const active = activeFamily === fam;
              return (
                <button
                  key={fam}
                  type="button"
                  title={sentenceCase(FAMILIES[fam].label)}
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
          {!isSite && <p className="label mt-1.5">Velocity and dual-pol products switch to single-site data.</p>}
        </Field>

        {isSite && tilts.length > 0 && (
          <Field label="Elevation tilt">
            <Segmented
              ariaLabel="Elevation tilt"
              size="sm"
              stretch
              value={tilts.some((t) => t.prefix === settings.tilt) ? settings.tilt : tilts[0]!.prefix}
              onChange={(tilt: TiltPrefix) => onChange({ tilt })}
              options={tilts.map((t) => ({ value: t.prefix, label: <span className="tabular">{t.angle}°</span>, title: t.code }))}
            />
          </Field>
        )}
      </Group>

      <Group title="Display">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Field label="Frames" htmlFor="radar-frames">
            <select id="radar-frames" value={settings.frames} onChange={(e) => onChange({ frames: Number(e.target.value) })} className={INPUT}>
              {[6, 12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n} frames
                </option>
              ))}
            </select>
          </Field>
          <Field label="Opacity" htmlFor="radar-opacity" aside={`${Math.round(settings.opacity * 100)}%`}>
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
        <Toggle label="Smooth cross-fade" checked={settings.crossfade} onChange={(crossfade) => onChange({ crossfade })} />
        <div>
          <Toggle label="Future radar (next 6 hours)" checked={settings.future} onChange={(future) => onChange({ future })} />
          <p className="label">{isSite ? "Shown with the national mosaic only." : "HRRR model forecast after the live scans, marked in orange on the timeline."}</p>
        </div>
        <Field label="GOES satellite">
          <Segmented
            ariaLabel="Satellite imagery"
            size="sm"
            stretch
            value={settings.satellite}
            onChange={(satellite) => onChange({ satellite })}
            options={[
              { value: "off", label: "Off" },
              { value: "infrared", label: "Infrared" },
              { value: "visible", label: "Visible" },
            ]}
          />
          {settings.satellite === "visible" && <p className="label mt-1.5">Visible imagery is dark at night; infrared works around the clock.</p>}
        </Field>
      </Group>

      <Group title="Overlays">
        <div className="-mt-1 divide-y divide-line">
          <Toggle label="NWS warnings" checked={settings.showWarnings} onChange={(showWarnings) => onChange({ showWarnings })} />
          <Toggle label="Projected storm tracks" checked={settings.showTracks} onChange={(showTracks) => onChange({ showTracks })} />
          <Toggle label="Lightning (last 15 min)" checked={settings.showLightning} onChange={(showLightning) => onChange({ showLightning })} />
          <Toggle label="Radar storm cells" checked={settings.showCells} onChange={(showCells) => onChange({ showCells })} />
          <Toggle label="NWS storm reports" checked={settings.showStormReports} onChange={(showStormReports) => onChange({ showStormReports })} />
          <Toggle label="Hurricanes and tropical storms" checked={settings.showTropical} onChange={(showTropical) => onChange({ showTropical })} />
          <Toggle label="SPC Day 1 outlook" checked={settings.showOutlook} onChange={(showOutlook) => onChange({ showOutlook })} />
          {settings.showOutlook && (
            <div className="py-2.5">
              <Segmented
                ariaLabel="Outlook hazard"
                size="sm"
                stretch
                value={settings.outlookKind}
                onChange={(outlookKind) => onChange({ outlookKind })}
                options={[
                  { value: "categorical", label: "Risk" },
                  { value: "tornado", label: "Tornado" },
                  { value: "hail", label: "Hail" },
                  { value: "wind", label: "Wind" },
                ]}
              />
            </div>
          )}
          {COMMUNITY_ENABLED && (
            <Toggle label="Spotter reports (6 h)" checked={settings.showReports} onChange={(showReports) => onChange({ showReports })} />
          )}
          <Toggle label="Radar sites" checked={settings.showSites} onChange={(showSites) => onChange({ showSites })} />
        </div>
      </Group>
    </div>
  );
}
