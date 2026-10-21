"use client";

import { useQuery } from "@tanstack/react-query";
import { Crosshair, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormat } from "@/hooks/use-format";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import type { LatLon } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { listLevel2 } from "@/lib/pro/nexrad/aws";
import { decodeVolume } from "@/lib/pro/nexrad/client";
import { modelPoint } from "@/lib/pro/model";
import { paletteScale } from "@/lib/pro/palettes";
import { formatHeight, freezingLevels, heightTicks, MAX_FILL_KM, topOf, volumePoints } from "@/lib/pro/volume3d";
import type { RadarSite } from "@/lib/radar/site-utils";
import { cn } from "@/lib/utils";
import { usePalette } from "@/store/palette-store";
import { useProStore, VOLUME_RADII } from "@/store/pro-store";
import { IconButton } from "../ui/button";
import { Toggle } from "../ui/misc";
import { Segmented } from "../ui/segmented";
import { usePro } from "./pro-context";
import { VolumeCanvas, type VolumeCanvasHandle, type VolumeScene } from "./volume-canvas";

const zulu = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
};

/** `value` once it has stopped changing for `ms`: rebuilding the points takes up to a few hundred ms, too slow for every step of a slider. */
function useSettled<T>(value: T, ms = 150): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Sheet colours (RGBA, 0–1): the freezing level blue, −20 °C violet. */
const ZERO_C: [number, number, number, number] = [0.22, 0.74, 0.97, 0.16];
const MINUS_20: [number, number, number, number] = [0.66, 0.55, 0.98, 0.14];

/**
 * The 3D volume tool: the newest Level II reflectivity volume of the
 * workspace's radar around a spot (lib/pro/volume3d), with a height scale
 * and the model's 0 °C and −20 °C levels, in the side panel or expanded
 * over the panels.
 */
export function VolumePanel({ point, site, until, onPoint }: { point: LatLon | null; site: RadarSite; until: number | null; onPoint: (p: LatLon) => void }) {
  const t = useT();
  const fmt = useFormat();
  const imperial = fmt.units.height === "ft";
  const dark = useResolvedTheme() === "dark";
  const { sync } = usePro();
  const settings = useProStore((s) => s.volume3d);
  const set = useProStore((s) => s.setVolume3d);
  const palette = usePalette("ref");
  const scale = useMemo(() => paletteScale("ref", palette), [palette]);
  const [expanded, setExpanded] = useState(false);
  const view = useRef<VolumeCanvasHandle>(null);

  // The newest volume (at or before the archive time).
  const list = useQuery({
    queryKey: ["vol3d-list", site.icao, until],
    queryFn: ({ signal }) => listLevel2(site.icao, (until ?? Date.now()) - 45 * 60_000, signal, until ?? undefined),
    refetchInterval: until != null ? false : 120_000,
    staleTime: until != null ? Infinity : 60_000,
    retry: 1,
  });
  const file = list.data?.at(-1);
  const volume = useQuery({
    queryKey: ["vol3d", file?.url],
    queryFn: () => decodeVolume(file!.url, "REF", { lat: site.lat, lon: site.lon }),
    enabled: !!file,
    staleTime: Infinity,
    // Tens of megabytes: let go soon after the panel closes (the decoder keeps the last two).
    gcTime: 30_000,
    retry: 1,
  });
  const model = useQuery({
    queryKey: ["vol3d-model", point && Math.round(point.lat * 20) / 20, point && Math.round(point.lon * 20) / 20],
    queryFn: ({ signal }) => modelPoint(point!, signal),
    enabled: !!point && until == null && settings.levels,
    staleTime: 15 * 60_000,
    retry: 1,
  });

  const threshold = useSettled(settings.threshold);
  const points = useMemo(
    () => (volume.data && point ? volumePoints(volume.data.sweeps, { focus: point, radiusKm: settings.radiusKm, threshold, scale, fill: settings.fill }) : null),
    [volume.data, point, settings.radiusKm, threshold, settings.fill, scale],
  );
  const levels = useMemo(() => (settings.levels && until == null ? freezingLevels(model.data?.sounding ?? null) : { zero: null, minus20: null }), [model.data, settings.levels, until]);
  const echoTop = points ? topOf(points, threshold) : null;
  const coreTop = points && threshold <= 50 ? topOf(points, 50) : null;

  const scene = useMemo<VolumeScene>(() => {
    const ground = points?.radar.z ?? 0;
    // Room for the tallest storms, and for the levels drawn.
    const top = Math.max(ground + 6, Math.ceil(Math.max(echoTop ?? 0, levels.minus20 ?? 0, 12) + 1));
    const sheets: VolumeScene["levels"] = [];
    if (levels.zero != null) sheets.push({ km: levels.zero, color: ZERO_C, label: `0 °C ${formatHeight(levels.zero, imperial)}` });
    if (levels.minus20 != null) sheets.push({ km: levels.minus20, color: MINUS_20, label: `−20 °C ${formatHeight(levels.minus20, imperial)}` });
    const R = settings.radiusKm;
    const labels: VolumeScene["labels"] = [{ at: [R, 0, ground], text: fmt.distanceKm(R), dx: 6 }];
    if (points && Math.hypot(points.radar.x, points.radar.y) <= R) labels.push({ at: [points.radar.x, points.radar.y, ground], text: site.icao, align: "center", dy: 12 });
    return { points, radiusKm: R, exaggeration: settings.exaggeration, ground, top, ticks: heightTicks(top, imperial).filter((x) => x.km >= ground - 0.05), axisUnit: imperial ? "kft" : "km", levels: sheets, labels, dark };
  }, [points, echoTop, levels, settings.radiusKm, settings.exaggeration, imperial, fmt, site.icao, dark]);

  const status = !point
    ? t("Click a storm on any panel.")
    : list.isError || volume.isError
      ? t("The radar's newest volume couldn't be loaded.")
      : list.isSuccess && !file
        ? t("No Level II volume from {site} in the last 45 minutes.", { site: site.icao })
        : !volume.data
          ? t("Loading every tilt of the volume…")
          : points && !points.count
            ? t("No echo of {dbz} dBZ or more here. Lower the threshold or pick another storm.", { dbz: threshold })
            : null;

  const label = point
    ? t("3D radar reflectivity from {site} around the spot, {n} tilts, echo of {dbz} dBZ and more", { site: site.icao, n: volume.data?.sweeps.length ?? 0, dbz: threshold })
    : t("3D radar view");

  const viewer = (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-control)] border border-line", expanded ? "min-h-0 flex-1" : "h-[320px]")}>
      <VolumeCanvas ref={view} scene={scene} label={label} className="absolute inset-0" />
      {status && <p className="pointer-events-none absolute inset-x-3 top-3 rounded-[4px] bg-surface-1/90 px-2 py-1.5 text-[12px] text-ink-2">{status}</p>}
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        <IconButton size="sm" variant="secondary" label={t("Reset the view")} onClick={() => view.current?.reset()}>
          <RotateCcw className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton size="sm" variant="secondary" label={expanded ? t("Back to the panel") : t("Expand over the panels")} onClick={() => setExpanded((e) => !e)}>
          {expanded ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
        </IconButton>
      </div>
    </div>
  );

  const controls = (
    <div className={cn("space-y-3 text-[12px]", expanded && "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-x-6 gap-y-3 space-y-0")}>
      <label className="block">
        <span className="flex items-baseline justify-between">
          <span className="label">{t("Lowest reflectivity shown")}</span>
          <span className="label tabular">{settings.threshold} dBZ</span>
        </span>
        <input
          type="range"
          min={5}
          max={65}
          step={5}
          value={settings.threshold}
          onChange={(e) => set({ threshold: Number(e.target.value) })}
          className="mt-1 block w-full accent-[var(--color-accent)]"
        />
      </label>
      <div>
        <p className="label mb-1">{t("Around the spot")}</p>
        <Segmented
          ariaLabel={t("Around the spot")}
          size="sm"
          stretch
          value={settings.radiusKm}
          onChange={(radiusKm) => set({ radiusKm })}
          options={VOLUME_RADII.map((r) => ({ value: r, label: fmt.distanceKm(r) }))}
        />
      </div>
      <div>
        <p className="label mb-1">{t("Height")}</p>
        <Segmented
          ariaLabel={t("Height exaggeration")}
          size="sm"
          stretch
          value={settings.exaggeration}
          onChange={(exaggeration) => set({ exaggeration })}
          options={[
            { value: 1, label: t("True") },
            { value: 2, label: "×2" },
            { value: 3, label: "×3" },
          ]}
        />
      </div>
      <div>
        <Toggle label={t("Fill between tilts")} checked={settings.fill} onChange={(v) => set({ fill: v })} />
        <p className="label">{settings.fill ? t("Gaps up to {h} between tilts that both have echo are filled in, blending the two.", { h: formatHeight(MAX_FILL_KM, imperial) }) : t("Each tilt as the radar scanned it.")}</p>
      </div>
      <div>
        <Toggle label={t("Freezing level and −20 °C")} checked={settings.levels} onChange={(v) => set({ levels: v })} />
        {settings.levels && until != null && <p className="label">{t("Not shown for the archive: the model only has today.")}</p>}
      </div>
      <button
        type="button"
        onClick={() => {
          const c = sync.getState().camera;
          onPoint({ lat: c.lat, lon: c.lng });
        }}
        className="flex items-center gap-1.5 text-[12px] text-accent hover:underline"
      >
        <Crosshair className="size-3.5" aria-hidden />
        {t("Centre on the map's middle")}
      </button>
    </div>
  );

  const facts = volume.data && points && (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
      <dt className="text-ink-3">{t("Volume")}</dt>
      <dd className="text-ink tabular">
        {site.icao} {zulu(volume.data.sweeps[0]?.time ?? 0)}, {t.plural(volume.data.sweeps.length, "{n} tilt", "{n} tilts")} ({volume.data.sweeps[0]?.elevation}°–{volume.data.sweeps.at(-1)?.elevation}°)
      </dd>
      {echoTop != null && (
        <>
          <dt className="text-ink-3">{t("Highest echo shown")}</dt>
          <dd className="text-ink tabular">{formatHeight(echoTop, imperial)}</dd>
        </>
      )}
      {coreTop != null && (
        <>
          <dt className="text-ink-3">{t("Top of the 50 dBZ core")}</dt>
          <dd className="text-ink tabular">
            {formatHeight(coreTop, imperial)}
            {levels.minus20 != null &&
              ` (${coreTop > levels.minus20 ? t("{h} above −20 °C", { h: formatHeight(coreTop - levels.minus20, imperial) }) : t("below −20 °C")})`}
          </dd>
        </>
      )}
      {points.stride > 1 && (
        <>
          <dt className="text-ink-3">{t("Detail")}</dt>
          <dd className="text-ink-2">{t("Every {n}th gate and radial, to keep it smooth. A smaller area shows all of them.", { n: points.stride })}</dd>
        </>
      )}
      <dt className="text-ink-3">{t("Heights")}</dt>
      <dd className="text-ink-2">{t("Above sea level, where the beam reaches with standard refraction.")}</dd>
    </dl>
  );

  if (expanded)
    return (
      <div className="absolute inset-0 z-30 flex flex-col gap-3 bg-canvas p-3">
        {viewer}
        <div className="grid shrink-0 gap-4 lg:grid-cols-[2fr_1fr]">
          {controls}
          {facts}
        </div>
      </div>
    );
  return (
    <div className="space-y-3 p-3">
      {viewer}
      {facts}
      {controls}
    </div>
  );
}
