"use client";

import { familiesAvailable, FAMILIES, resolveTilts, type ProductFamily, type TiltPrefix } from "@/lib/radar/products";
import { nearestSites, type RadarSite } from "@/lib/radar/site-utils";
import { cn } from "@/lib/utils";
import type { RadarSettings } from "@/store/app-store";
import { Segmented } from "../ui/segmented";
import { Toggle } from "../ui/misc";

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
  const isSite = settings.source === "site";
  const families = isSite ? familiesAvailable(available) : (["reflectivity"] as ProductFamily[]);
  const tilts = isSite ? resolveTilts(settings.family, available) : [];
  const nearby = nearestSites(location, 6);

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Source</p>
        <Segmented
          ariaLabel="Radar source"
          value={settings.source}
          onChange={(source) => onChange({ source, ...(source === "mosaic" ? { family: "reflectivity" as const } : {}) })}
          options={[
            { value: "mosaic", label: "National mosaic" },
            { value: "site", label: "Single site" },
          ]}
        />
      </div>

      {isSite && (
        <div>
          <label htmlFor="radar-site" className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            Radar site <span className="normal-case">· or click one on the map</span>
          </label>
          <select
            id="radar-site"
            value={site?.icao ?? ""}
            onChange={(e) => onChange({ site: e.target.value || null })}
            className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm ring-1 ring-white/10 outline-none focus:ring-accent"
          >
            <option value="">Nearest to location</option>
            {nearby.map((s) => (
              <option key={s.icao} value={s.icao}>
                {s.icao} — {s.place}, {s.state} ({Math.round(s.distanceKm)} km)
              </option>
            ))}
            {site && !nearby.some((n) => n.icao === site.icao) && (
              <option value={site.icao}>
                {site.icao} — {site.place}, {site.state}
              </option>
            )}
          </select>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Product</p>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(FAMILIES) as ProductFamily[]).map((fam) => {
            const enabled = families.includes(fam);
            const active = settings.family === fam;
            return (
              <button
                key={fam}
                type="button"
                title={FAMILIES[fam].label}
                onClick={() => onChange(isSite ? { family: fam } : { source: "site", family: fam })}
                disabled={isSite && !enabled}
                className={cn(
                  "rounded-xl px-2 py-1.5 text-xs font-semibold ring-1 transition disabled:opacity-30",
                  active ? "bg-white text-black ring-white" : "text-ink-2 ring-white/10 hover:bg-white/5",
                )}
              >
                {FAMILIES[fam].short}
              </button>
            );
          })}
        </div>
        {!isSite && <p className="mt-1.5 text-[11px] text-ink-3">Velocity &amp; dual-pol products switch to single-site data.</p>}
      </div>

      {isSite && tilts.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Elevation tilt</p>
          <Segmented
            ariaLabel="Elevation tilt"
            size="sm"
            value={tilts.some((t) => t.prefix === settings.tilt) ? settings.tilt : tilts[0]!.prefix}
            onChange={(tilt: TiltPrefix) => onChange({ tilt })}
            options={tilts.map((t) => ({ value: t.prefix, label: `${t.angle}°`, title: t.code }))}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-3 uppercase">Frames</span>
          <select value={settings.frames} onChange={(e) => onChange({ frames: Number(e.target.value) })} className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm ring-1 ring-white/10 outline-none">
            {[6, 12, 18, 24].map((n) => (
              <option key={n} value={n}>
                {n} frames
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-3 uppercase">Opacity {Math.round(settings.opacity * 100)}%</span>
          <input type="range" min={0.2} max={1} step={0.05} value={settings.opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) })} className="mt-2 w-full accent-[var(--accent)]" />
        </label>
      </div>

      <div className="divide-y divide-white/[0.06] rounded-2xl bg-white/[0.03] px-3">
        <Toggle label="Smooth cross-fade" checked={settings.crossfade} onChange={(crossfade) => onChange({ crossfade })} />
        <Toggle label="NWS warnings" checked={settings.showWarnings} onChange={(showWarnings) => onChange({ showWarnings })} />
        <Toggle label="Projected storm tracks" checked={settings.showTracks} onChange={(showTracks) => onChange({ showTracks })} />
        <Toggle label="SPC Day 1 outlook" checked={settings.showOutlook} onChange={(showOutlook) => onChange({ showOutlook })} />
        <Toggle label="Spotter reports (6 h)" checked={settings.showReports} onChange={(showReports) => onChange({ showReports })} />
        <Toggle label="Radar sites" checked={settings.showSites} onChange={(showSites) => onChange({ showSites })} />
      </div>
    </div>
  );
}
