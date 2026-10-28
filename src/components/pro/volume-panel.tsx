"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Camera, Crosshair, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormat } from "@/hooks/use-format";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import type { LatLon } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { INBOUND, MS_TO_KT, OUTBOUND, shellColor, surfaceBox } from "@/lib/pro/isosurface";
import { buildSurfacesOffThread } from "@/lib/pro/isosurface-client";
import { listLevel2 } from "@/lib/pro/nexrad/aws";
import { decodeVolume } from "@/lib/pro/nexrad/client";
import { modelPoint } from "@/lib/pro/model";
import { paletteScale } from "@/lib/pro/palettes";
import { focusFromRadar, formatHeight, freezingLevels, groundLines, heightTicks, MAX_FILL_KM, topOf, volumePoints } from "@/lib/pro/volume3d";
import { saveExport } from "@/lib/radar/export-loop";
import type { RadarSite } from "@/lib/radar/site-utils";
import { NEXRAD_SITES } from "@/lib/radar/sites";
import { cn } from "@/lib/utils";
import { usePalette } from "@/store/palette-store";
import { useProStore, VOLUME_RADII } from "@/store/pro-store";
import { IconButton } from "../ui/button";
import { Toggle } from "../ui/misc";
import { Segmented } from "../ui/segmented";
import { usePro } from "./pro-context";
import { VolumeCanvas, type SceneSurface, type VolumeCanvasHandle, type VolumeScene } from "./volume-canvas";

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
/** Velocity shells are drawn this solid. */
const VELOCITY_OPACITY = 0.9;

/** County lines for the ground, fetched once (the map's own: scripts/vendor-county-lines.mjs); null where there are none. */
async function countyLines(): Promise<number[][][] | null> {
  const r = await fetch("/vendor/us-county-lines.json");
  if (!r.ok) return null;
  const f = (await r.json()) as { geometry?: { coordinates?: number[][][] } };
  return f.geometry?.coordinates ?? null;
}

type Cut = { axis: "off" | "x" | "y" | "z"; at: number };

const rgbCss = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/**
 * The 3D volume tool: the newest Level II volume of the workspace's radar
 * around a spot, as shaded reflectivity surfaces (lib/pro/isosurface, built
 * in a worker) with optional velocity shells, or every gate as a point
 * (lib/pro/volume3d); with a height scale, the model's 0 °C and −20 °C
 * levels, county lines on the ground and a cut-away plane, in the side panel
 * or expanded over the panels.
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
  const [cut, setCut] = useState<Cut>({ axis: "off", at: 0.5 });
  const view = useRef<VolumeCanvasHandle>(null);
  const surfacesView = settings.view === "surfaces";
  const velocityOn = surfacesView && settings.velocity;

  // The newest volume (at or before the archive time).
  const list = useQuery({
    queryKey: ["vol3d-list", site.icao, until],
    queryFn: ({ signal }) => listLevel2(site.icao, (until ?? Date.now()) - 45 * 60_000, signal, until ?? undefined),
    refetchInterval: until != null ? false : 120_000,
    staleTime: until != null ? Infinity : 60_000,
    retry: 1,
  });
  const file = list.data?.at(-1);
  // Volumes from before 2008 don't say where the radar is, or how high: the site table's ground height stands in.
  const heightM = NEXRAD_SITES.find((s) => s[0] === site.icao)?.[5];
  const volume = useQuery({
    queryKey: ["vol3d", file?.url],
    queryFn: () => decodeVolume(file!.url, "REF", { lat: site.lat, lon: site.lon, heightM }),
    enabled: !!file,
    staleTime: Infinity,
    // Tens of megabytes: let go soon after the panel closes (the decoder keeps the last two).
    gcTime: 30_000,
    retry: 1,
  });
  const velVolume = useQuery({
    queryKey: ["vol3d-vel", file?.url],
    queryFn: () => decodeVolume(file!.url, "VEL", { lat: site.lat, lon: site.lon, heightM }),
    enabled: !!file && velocityOn,
    staleTime: Infinity,
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
  const counties = useQuery({ queryKey: ["vol3d-counties"], queryFn: countyLines, enabled: settings.counties, staleTime: Infinity, gcTime: 5 * 60_000, retry: 0 });

  const threshold = useSettled(settings.threshold);
  const points = useMemo(
    () => (!surfacesView && volume.data && point ? volumePoints(volume.data.sweeps, { focus: point, radiusKm: settings.radiusKm, threshold, scale, fill: settings.fill }) : null),
    [surfacesView, volume.data, point, settings.radiusKm, threshold, settings.fill, scale],
  );

  // The shells shown, lowest first; built again once the sliders settle (their opacity needs no rebuild).
  const levelsKey = useSettled([...new Set(settings.shells.filter((s) => s.on).map((s) => s.dbz))].sort((a, b) => a - b).join(","));
  const velocityMs = useSettled(settings.velocityMs);
  const velSweeps = velocityOn ? (velVolume.data?.sweeps ?? null) : null;
  const surfaces = useQuery({
    queryKey: ["vol3d-surfaces", file?.url, point?.lat, point?.lon, settings.radiusKm, levelsKey, velSweeps ? velocityMs : null],
    queryFn: () =>
      buildSurfacesOffThread({ key: `${file!.url}|REF`, sweeps: volume.data!.sweeps }, velSweeps ? { key: `${file!.url}|VEL`, sweeps: velSweeps } : null, {
        focus: point!,
        radiusKm: settings.radiusKm,
        levels: levelsKey ? levelsKey.split(",").map(Number) : [],
        velocityMs: velSweeps ? velocityMs : null,
      }),
    enabled: surfacesView && !!volume.data && !!point && (!velocityOn || !!velVolume.data || velVolume.isError),
    staleTime: Infinity,
    gcTime: 30_000,
    retry: 0,
    // The old shells stay up while new ones are built.
    placeholderData: keepPreviousData,
  });
  const shellSet = surfacesView ? surfaces.data : undefined;

  const sceneSurfaces = useMemo<SceneSurface[]>(() => {
    if (!shellSet) return [];
    const out: SceneSurface[] = [];
    for (const sh of settings.shells) {
      const i = shellSet.levels.indexOf(sh.dbz);
      if (sh.on && i >= 0) out.push({ mesh: shellSet.ref[i]!, color: shellColor(scale, sh.dbz), opacity: sh.opacity, order: sh.dbz });
    }
    if (velocityOn && shellSet.vel) {
      out.push({ mesh: shellSet.vel.inbound, color: INBOUND, opacity: VELOCITY_OPACITY, order: 100 });
      out.push({ mesh: shellSet.vel.outbound, color: OUTBOUND, opacity: VELOCITY_OPACITY, order: 100 });
    }
    return out;
  }, [shellSet, settings.shells, scale, velocityOn]);

  const levels = useMemo(() => (settings.levels && until == null ? freezingLevels(model.data?.sounding ?? null) : { zero: null, minus20: null }), [model.data, settings.levels, until]);
  const lowestShell = shellSet && settings.shells.filter((s) => s.on && shellSet.levels.includes(s.dbz)).sort((a, b) => a.dbz - b.dbz)[0];
  const echoTop = surfacesView ? (lowestShell ? (shellSet.ref[shellSet.levels.indexOf(lowestShell.dbz)]?.top ?? null) : null) : points ? topOf(points, threshold) : null;
  const coreTop = surfacesView ? (shellSet?.top50 ?? null) : points && threshold <= 50 ? topOf(points, 50) : null;
  const ground = (volume.data?.sweeps[0]?.heightM ?? heightM ?? 0) / 1000;
  const top = Math.max(ground + 6, Math.ceil(Math.max(echoTop ?? 0, levels.minus20 ?? 0, 12) + 1));
  const radar = volume.data?.sweeps[0] ?? site;
  const outlines = useMemo(
    () => (settings.counties && counties.data && point ? groundLines(counties.data, radar, point, settings.radiusKm, ground) : null),
    [settings.counties, counties.data, point, radar, settings.radiusKm, ground],
  );
  const box = surfacesView ? surfaceBox(settings.radiusKm) : null;

  const scene = useMemo<VolumeScene>(() => {
    // Room for the tallest storms, and for the levels drawn.
    const sheets: VolumeScene["levels"] = [];
    if (levels.zero != null) sheets.push({ km: levels.zero, color: ZERO_C, label: `0 °C ${formatHeight(levels.zero, imperial)}` });
    if (levels.minus20 != null) sheets.push({ km: levels.minus20, color: MINUS_20, label: `−20 °C ${formatHeight(levels.minus20, imperial)}` });
    const R = settings.radiusKm;
    const labels: VolumeScene["labels"] = [{ at: [R, 0, ground], text: fmt.distanceKm(R), dx: 6 }];
    const r = point && volume.data ? focusFromRadar(radar, point) : null;
    if (r && Math.hypot(r.x, r.y) <= R) labels.push({ at: [-r.x, -r.y, ground], text: site.icao, align: "center", dy: 12 });
    const at = cut.axis === "z" ? ground + cut.at * (top - ground) : -R + cut.at * 2 * R;
    return {
      points,
      surfaces: sceneSurfaces,
      box: box && box.half < R ? box.half : null,
      radiusKm: R,
      exaggeration: settings.exaggeration,
      ground,
      top,
      ticks: heightTicks(top, imperial).filter((x) => x.km >= ground - 0.05),
      axisUnit: imperial ? "kft" : "km",
      ticks2: heightTicks(top, !imperial).filter((x) => x.km >= ground - 0.05),
      axisUnit2: imperial ? "km" : "kft",
      levels: sheets,
      outlines,
      cut: cut.axis === "off" ? null : { axis: cut.axis, at },
      labels,
      dark,
    };
  }, [points, sceneSurfaces, box, levels, settings.radiusKm, settings.exaggeration, ground, top, imperial, fmt, site.icao, dark, outlines, cut, point, volume.data, radar]);

  const noShells = surfacesView && shellSet && sceneSurfaces.every((s) => !s.mesh.indices.length);
  const status = !point
    ? t("Click a storm on any panel.")
    : list.isError || volume.isError
      ? t("The radar's newest volume couldn't be loaded.")
      : list.isSuccess && !file
        ? t("No Level II volume from {site} in the last 45 minutes.", { site: site.icao })
        : !volume.data
          ? t("Loading every tilt of the volume…")
          : surfacesView
            ? surfaces.isError
              ? t("The surfaces couldn't be built.")
              : !shellSet
                ? t("Building the surfaces…")
                : !sceneSurfaces.length
                  ? t("Turn on a surface to see the storm.")
                  : noShells
                    ? t("No echo of {dbz} dBZ or more here. Lower the threshold or pick another storm.", { dbz: lowestShell?.dbz ?? settings.shells[0]!.dbz })
                    : null
            : points && !points.count
              ? t("No echo of {dbz} dBZ or more here. Lower the threshold or pick another storm.", { dbz: threshold })
              : null;

  const shownLevels = settings.shells.filter((s) => s.on).map((s) => s.dbz);
  const label = !point
    ? t("3D radar view")
    : surfacesView
      ? t("3D radar reflectivity surfaces from {site} around the spot, at {levels} dBZ", { site: site.icao, levels: shownLevels.join(", ") })
      : t("3D radar reflectivity from {site} around the spot, {n} tilts, echo of {dbz} dBZ and more", { site: site.icao, n: volume.data?.sweeps.length ?? 0, dbz: threshold });

  const snapshot = async () => {
    const time = zulu(volume.data?.sweeps[0]?.time ?? Date.now());
    const blob = await view.current?.snapshot(`${site.icao} ${time}`);
    if (!blob) return;
    await saveExport({ blob, mimeType: "image/png", filename: `${site.icao}-3d-${time}.png`, width: 0, height: 0, frames: 1 }, undefined, t);
  };

  const viewer = (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-control)] border border-line", expanded ? "min-h-0 flex-1" : "h-[320px]")}>
      <VolumeCanvas ref={view} scene={scene} label={label} unsupported={t("This device can't draw the 3D view (it needs WebGL 2).")} className="absolute inset-0" />
      {status && <p className="pointer-events-none absolute inset-x-3 top-11 rounded-[4px] bg-surface-1/90 px-2 py-1.5 text-[12px] text-ink-2">{status}</p>}
      {surfacesView && surfaces.isFetching && shellSet && <p className="pointer-events-none absolute bottom-2 left-14 text-[11px] text-ink-3">{t("Building the surfaces…")}</p>}
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        <IconButton size="sm" variant="secondary" label={t("Zoom in")} onClick={() => view.current?.zoom(0.8)}>
          <ZoomIn className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton size="sm" variant="secondary" label={t("Zoom out")} onClick={() => view.current?.zoom(1.25)}>
          <ZoomOut className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton size="sm" variant="secondary" label={t("Reset the view")} onClick={() => view.current?.reset()}>
          <RotateCcw className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton size="sm" variant="secondary" label={t("Save a picture of the view")} onClick={() => void snapshot()} disabled={!volume.data}>
          <Camera className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton size="sm" variant="secondary" label={expanded ? t("Back to the panel") : t("Expand over the panels")} onClick={() => setExpanded((e) => !e)}>
          {expanded ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
        </IconButton>
      </div>
    </div>
  );

  const range = "mt-1 block w-full accent-[var(--color-accent)]";
  const controls = (
    <div className={cn("space-y-3 text-[12px]", expanded && "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-x-6 gap-y-3 space-y-0")}>
      <div>
        <p className="label mb-1">{t("Show")}</p>
        <Segmented
          ariaLabel={t("Show")}
          size="sm"
          stretch
          value={settings.view}
          onChange={(v) => set({ view: v })}
          options={[
            { value: "surfaces", label: t("Surfaces") },
            { value: "points", label: t("Every gate") },
          ]}
        />
      </div>
      {surfacesView ? (
        <div className="space-y-2">
          <p className="label">{t("Reflectivity surfaces")}</p>
          {settings.shells.map((sh, i) => {
            const patch = (p: Partial<typeof sh>) => set({ shells: settings.shells.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <div key={i} className={cn("grid grid-cols-[auto_1fr_1fr] items-center gap-x-2", !sh.on && "opacity-60")}>
                <label className="flex min-h-8 cursor-pointer items-center gap-1.5 pointer-coarse:min-h-11">
                  <input type="checkbox" checked={sh.on} onChange={(e) => patch({ on: e.target.checked })} className="accent-[var(--color-accent)]" />
                  <span aria-hidden className="size-3 rounded-[2px] border border-line" style={{ background: rgbCss(shellColor(scale, sh.dbz)) }} />
                  <span className="tabular w-[52px] text-ink">{sh.dbz} dBZ</span>
                </label>
                <input
                  type="range"
                  min={20}
                  max={70}
                  step={5}
                  value={sh.dbz}
                  aria-label={t("Surface {n} threshold", { n: i + 1 })}
                  onChange={(e) => patch({ dbz: Number(e.target.value) })}
                  className={range}
                />
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={sh.opacity}
                  aria-label={t("Surface {n} opacity", { n: i + 1 })}
                  title={`${Math.round(sh.opacity * 100)}%`}
                  onChange={(e) => patch({ opacity: Number(e.target.value) })}
                  className={range}
                />
              </div>
            );
          })}
          <p className="label">{t("Threshold, then how solid it is.")}</p>
        </div>
      ) : (
        <label className="block">
          <span className="flex items-baseline justify-between">
            <span className="label">{t("Lowest reflectivity shown")}</span>
            <span className="label tabular">{settings.threshold} dBZ</span>
          </span>
          <input type="range" min={5} max={65} step={5} value={settings.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} className={range} />
        </label>
      )}
      {surfacesView && (
        <div>
          <Toggle label={t("Velocity surfaces")} checked={settings.velocity} onChange={(v) => set({ velocity: v })} />
          {settings.velocity && (
            <>
              <label className="block">
                <span className="flex items-baseline justify-between">
                  <span className="label">{t("Inbound and outbound at")}</span>
                  <span className="label tabular">
                    ±{settings.velocityMs} m/s ({Math.round(settings.velocityMs * MS_TO_KT)} kt)
                  </span>
                </span>
                <input type="range" min={5} max={50} step={1} value={settings.velocityMs} onChange={(e) => set({ velocityMs: Number(e.target.value) })} className={range} />
              </label>
              <p className="label">
                <span style={{ color: rgbCss(INBOUND) }}>■</span> {t("towards the radar")} <span style={{ color: rgbCss(OUTBOUND) }}>■</span> {t("away from it")}.{" "}
                {velVolume.isError ? t("The volume's velocity couldn't be loaded.") : !velVolume.data ? t("Loading the velocity…") : t("Raw velocity, not dealiased: folded gates can make false shells.")}
              </p>
            </>
          )}
        </div>
      )}
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
      <label className="block">
        <span className="flex items-baseline justify-between">
          <span className="label">{t("Height exaggeration")}</span>
          <span className="label tabular">{settings.exaggeration === 1 ? t("True") : `×${settings.exaggeration}`}</span>
        </span>
        <input type="range" min={1} max={5} step={0.5} value={settings.exaggeration} onChange={(e) => set({ exaggeration: Number(e.target.value) })} className={range} />
      </label>
      <div>
        <p className="label mb-1">{t("Cut away")}</p>
        <Segmented
          ariaLabel={t("Cut away")}
          size="sm"
          stretch
          value={cut.axis}
          onChange={(axis) => setCut((c) => ({ ...c, axis }))}
          options={[
            { value: "off", label: t("Nothing") },
            { value: "x", label: t("East side") },
            { value: "y", label: t("North side") },
            { value: "z", label: t("Top") },
          ]}
        />
        {cut.axis !== "off" && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={cut.at}
            aria-label={t("Where to cut")}
            onChange={(e) => setCut((c) => ({ ...c, at: Number(e.target.value) }))}
            className={range}
          />
        )}
      </div>
      {!surfacesView && (
        <div>
          <Toggle label={t("Fill between tilts")} checked={settings.fill} onChange={(v) => set({ fill: v })} />
          <p className="label">{settings.fill ? t("Gaps up to {h} between tilts that both have echo are filled in, blending the two.", { h: formatHeight(MAX_FILL_KM, imperial) }) : t("Each tilt as the radar scanned it.")}</p>
        </div>
      )}
      <div>
        <Toggle label={t("Freezing level and −20 °C")} checked={settings.levels} onChange={(v) => set({ levels: v })} />
        {settings.levels && until != null && <p className="label">{t("Not shown for the archive: the model only has today.")}</p>}
      </div>
      <Toggle label={t("County lines")} checked={settings.counties} onChange={(v) => set({ counties: v })} />
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

  const facts = volume.data && (points || shellSet) && (
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
      {box && (
        <>
          <dt className="text-ink-3">{t("Surfaces")}</dt>
          <dd className="text-ink-2">
            {t("Built on a {w} square around the spot, every {d} across and {dz} up, to {h}. Between tilts, values are blended by height.", {
              w: fmt.distanceKm(box.half * 2),
              d: fmt.distanceKm(box.step),
              dz: formatHeight(box.dz, imperial),
              h: formatHeight(box.top, imperial),
            })}
          </dd>
        </>
      )}
      {points && points.stride > 1 && (
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
        <div className="grid max-h-[45%] shrink-0 gap-4 overflow-y-auto lg:grid-cols-[2fr_1fr]">
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
