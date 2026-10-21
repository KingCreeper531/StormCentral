"use client";

import { RotateCcw } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import { isDefaultStyle, LIMITS, type BasemapId, type CountyMode, type LineStyle, type MapStyle, type RoadMode } from "@/lib/map/style";
import { cn } from "@/lib/utils";
import { useMapStyleStore } from "@/store/map-style-store";
import { Button } from "../ui/button";
import { MapPresets } from "./map-presets";
import { Toggle } from "../ui/misc";
import { Segmented } from "../ui/segmented";

const RANGE = "block h-9 w-full accent-[var(--color-accent)] pointer-coarse:h-11";

const LINE_COLORS = ["#ffffff", "#6b7280", "#facc15", "#38bdf8", "#f472b6", "#000000"];
const ROAD_COLORS = ["#4b5563", "#9ca3af", "#ffffff", "#facc15", "#f97316"];
const WATER_COLORS = ["#070b12", "#0b1d33", "#1f3b57", "#9cc3e6", "#d6e4f0"];
const LAND_COLORS = ["#030406", "#111827", "#2a2f38", "#e5e7eb", "#f3eee3"];

const pct = (n: number) => `${Math.round(n * 100)}%`;
const times = (n: number) => `×${Number(n.toFixed(2))}`;

/** The basemap's colour (null) or a preset or any colour from the picker. */
function ColorChoice({ label, value, presets, onChange }: { label: string; value: string | null; presets: readonly string[]; onChange: (c: string | null) => void }) {
  const t = useT();
  const custom = value !== null && !presets.includes(value);
  const swatch = "size-6 shrink-0 rounded-full border-2 pointer-coarse:size-8";
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={cn("h-6 rounded-full border px-2 text-[11px] text-ink-2 pointer-coarse:h-8", value === null ? "border-ink text-ink" : "border-line hover:border-line-strong")}
      >
        {t("Map's own")}
      </button>
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t("Colour {c}", { c })}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(swatch, value === c ? "border-accent" : "border-line")}
          style={{ background: c }}
        />
      ))}
      <label className={cn(swatch, "relative cursor-pointer overflow-hidden", custom ? "border-accent" : "border-line")} style={{ background: custom ? value! : "conic-gradient(#f87171, #facc15, #4ade80, #38bdf8, #a78bfa, #f87171)" }}>
        <span className="sr-only">{t("Pick any colour")}</span>
        <input type="color" value={value ?? "#ffffff"} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

function Slider({ id, label, aside, min, max, step, value, onChange }: { id: string; label: string; aside: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className="label tabular">{aside}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={RANGE} />
    </div>
  );
}

/** Colour and width for a kind of line, shown while it's on. */
function LineDetails({ id, name, line, onChange }: { id: string; name: string; line: Omit<LineStyle, "show">; onChange: (patch: Partial<LineStyle>) => void }) {
  const t = useT();
  return (
    <div className="space-y-2 pb-3">
      <ColorChoice label={t("{name} colour", { name })} value={line.color} presets={LINE_COLORS} onChange={(color) => onChange({ color })} />
      <Slider id={`${id}-width`} label={t("Line width")} aside={times(line.width)} min={LIMITS.width[0]} max={LIMITS.width[1]} step={0.25} value={line.width} onChange={(width) => onChange({ width })} />
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h4 className="pt-1 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{children}</h4>;
}

/**
 * The map's look (lib/map/style.ts), for every map in the app: basemap,
 * terrain shading and 3D, borders, roads, labels and colours.
 */
export function MapStyleControls() {
  const t = useT();
  const style = useMapStyleStore((s) => s.style);
  const set = useMapStyleStore((s) => s.setStyle);
  const reset = useMapStyleStore((s) => s.reset);
  const line = (key: "countries" | "states") => (patch: Partial<LineStyle>) => set({ [key]: { ...style[key], ...patch } } as Partial<MapStyle>);

  return (
    <div className="space-y-4">
      <MapPresets />
      <div>
        <p className="label mb-1.5">{t("Basemap")}</p>
        <Segmented<BasemapId>
          ariaLabel={t("Basemap")}
          size="sm"
          stretch
          value={style.basemap}
          onChange={(basemap) => set({ basemap })}
          options={[
            { value: "auto", label: t("Auto"), title: t("Dark or light with the app's theme") },
            { value: "dark", label: t("Dark") },
            { value: "light", label: t("Light") },
            { value: "streets", label: t("Streets") },
          ]}
        />
      </div>

      <Heading>{t("Terrain")}</Heading>
      <Slider
        id="map-hillshade"
        label={t("Terrain shading")}
        aside={style.hillshade > 0 ? pct(style.hillshade) : t("Off")}
        min={0}
        max={1}
        step={0.1}
        value={style.hillshade}
        onChange={(hillshade) => set({ hillshade })}
      />
      <div>
        <Toggle label={t("3D terrain")} checked={style.terrain3d} onChange={(terrain3d) => set({ terrain3d })} />
        <p className="label">{t("On the radar map. Tilt it with a right-click drag or two fingers; the compass button turns it back flat.")}</p>
        {style.terrain3d && (
          <div className="mt-2">
            <Slider
              id="map-exaggeration"
              label={t("Height")}
              aside={times(style.exaggeration)}
              min={LIMITS.exaggeration[0]}
              max={LIMITS.exaggeration[1]}
              step={0.25}
              value={style.exaggeration}
              onChange={(exaggeration) => set({ exaggeration })}
            />
          </div>
        )}
      </div>

      <Heading>{t("Borders")}</Heading>
      <div className="-mt-2">
        <Toggle label={t("Countries")} checked={style.countries.show} onChange={(show) => line("countries")({ show })} />
        {style.countries.show && <LineDetails id="map-countries" name={t("Countries")} line={style.countries} onChange={line("countries")} />}
        <Toggle label={t("States and provinces")} checked={style.states.show} onChange={(show) => line("states")({ show })} />
        {style.states.show && <LineDetails id="map-states" name={t("States and provinces")} line={style.states} onChange={line("states")} />}
        <div className="flex min-h-10 items-center justify-between gap-3 pointer-coarse:min-h-11">
          <span className="text-[13px] text-ink-2">{t("Counties")}</span>
          <Segmented<CountyMode>
            ariaLabel={t("Counties")}
            size="sm"
            value={style.counties.show}
            onChange={(show) => set({ counties: { ...style.counties, show } })}
            options={[
              { value: "off", label: t("Off") },
              { value: "near", label: t("Zoomed in"), title: t("From about city scale, as the map draws them") },
              { value: "always", label: t("Always"), title: t("US counties at every zoom") },
            ]}
          />
        </div>
        {style.counties.show !== "off" && (
          <LineDetails id="map-counties" name={t("Counties")} line={style.counties} onChange={(patch) => set({ counties: { ...style.counties, ...patch, show: style.counties.show } })} />
        )}
      </div>

      <Heading>{t("Roads")}</Heading>
      <Segmented<RoadMode>
        ariaLabel={t("Roads")}
        size="sm"
        stretch
        value={style.roads}
        onChange={(roads) => set({ roads })}
        options={[
          { value: "off", label: t("Off") },
          { value: "major", label: t("Highways") },
          { value: "all", label: t("All roads") },
        ]}
      />
      {style.roads !== "off" && <ColorChoice label={t("Road colour")} value={style.roadColor} presets={ROAD_COLORS} onChange={(roadColor) => set({ roadColor })} />}

      <Heading>{t("Labels")}</Heading>
      <div className="-mt-2">
        <Toggle label={t("Cities and places")} checked={style.placeLabels} onChange={(placeLabels) => set({ placeLabels })} />
        <Toggle label={t("Road names")} checked={style.roadLabels} onChange={(roadLabels) => set({ roadLabels })} />
        <Toggle label={t("Rivers, lakes and seas")} checked={style.waterLabels} onChange={(waterLabels) => set({ waterLabels })} />
        <Toggle label={t("Airports, parks and peaks")} checked={style.poiLabels} onChange={(poiLabels) => set({ poiLabels })} />
      </div>
      <Slider
        id="map-label-size"
        label={t("Label size")}
        aside={pct(style.labelSize)}
        min={LIMITS.labelSize[0]}
        max={LIMITS.labelSize[1]}
        step={0.1}
        value={style.labelSize}
        onChange={(labelSize) => set({ labelSize })}
      />

      <Heading>{t("Land and water")}</Heading>
      <div className="space-y-1.5">
        <p className="label">{t("Water")}</p>
        <ColorChoice label={t("Water colour")} value={style.water} presets={WATER_COLORS} onChange={(water) => set({ water })} />
      </div>
      <div className="space-y-1.5">
        <p className="label">{t("Land")}</p>
        <ColorChoice label={t("Land colour")} value={style.land} presets={LAND_COLORS} onChange={(land) => set({ land })} />
      </div>
      <div className="-mt-1">
        <Toggle label={t("Parks, woods and land use")} checked={style.landcover} onChange={(landcover) => set({ landcover })} />
        <Toggle label={t("Buildings")} checked={style.buildings} onChange={(buildings) => set({ buildings })} />
      </div>

      {!isDefaultStyle(style) && (
        <Button size="sm" onClick={reset}>
          <RotateCcw className="size-3.5" aria-hidden />
          {t("Reset the map style")}
        </Button>
      )}
    </div>
  );
}
