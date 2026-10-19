"use client";

import { useEffect, useRef, useState } from "react";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import { bearingDeg, haversineKm } from "@/lib/geo";
import { modelPoint, readoutFrom, type ModelReadout } from "@/lib/pro/model";
import { MAX_COLOR_DISTANCE, samplePixel, valueFromColor } from "@/lib/pro/sample";
import { HC_CLASSES, type ValueScale } from "@/lib/pro/scales";
import { useProSync } from "@/lib/pro/sync";
import type { RadarSite } from "@/lib/radar/site-utils";
import { usePro } from "./pro-context";

interface PaneValue {
  label: string;
  text: string;
}

function describe(rgba: [number, number, number, number] | null, scale: ValueScale, t: (s: string) => string): string {
  if (!rgba) return "—";
  if (rgba[3] < 40) return t("no echo");
  const rgb = [rgba[0], rgba[1], rgba[2]] as const;
  for (const s of scale.special ?? []) {
    const n = parseInt(s.color.slice(1), 16);
    if (Math.hypot(rgb[0] - ((n >> 16) & 255), rgb[1] - ((n >> 8) & 255), rgb[2] - (n & 255)) < 12) return s.label;
  }
  const m = valueFromColor(rgb, scale.stops, scale.categorical);
  if (!m || m.distance > MAX_COLOR_DISTANCE) return "?";
  if (scale.categorical) return t(HC_CLASSES[Math.round(m.value)] ?? "?");
  return `≈${m.value.toFixed(scale.decimals)} ${scale.unit}`;
}

/**
 * Continuous cursor readout: position, ground height, range and bearing from
 * the radar, the value under the cursor in every pane, and the model's
 * surface and shear fields there.
 */
export function ReadoutHud({ site }: { site: RadarSite | null }) {
  const t = useT();
  const f = useFormat();
  const { sync, probes } = usePro();
  const cursor = useProSync(sync, (s) => s.cursor);
  const index = useProSync(sync, (s) => s.index);
  const [values, setValues] = useState<PaneValue[]>([]);
  const [model, setModel] = useState<ModelReadout | null>(null);
  const seq = useRef(0);

  // Pane values: re-read on every pointer move (throttled to animation frames at the source) and loop step.
  useEffect(() => {
    if (!cursor) return;
    const run = ++seq.current;
    const id = setTimeout(async () => {
      const entries = [...probes.entries()].sort(([, a], [, b]) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      const out = await Promise.all(
        entries.map(async ([, p]): Promise<PaneValue | null> => {
          const frame = p.frame();
          const scale = frame ? p.scale(frame) : null;
          if (!frame || !scale) return null;
          const px = await samplePixel({ tileUrl: frame.tileUrl, tileSize: frame.tileSize ?? 256, maxzoom: frame.maxzoom }, cursor.lng, cursor.lat, p.zoom());
          return { label: p.label, text: describe(px, scale, t) };
        }),
      );
      if (run === seq.current) setValues(out.filter((v): v is PaneValue => !!v));
    }, 30);
    return () => clearTimeout(id);
  }, [cursor, index, probes, t]);

  // Model fields: once the pointer rests.
  useEffect(() => {
    if (!cursor) return;
    const ac = new AbortController();
    const id = setTimeout(() => {
      modelPoint({ lat: cursor.lat, lon: cursor.lng }, ac.signal)
        .then((m) => !ac.signal.aborted && setModel(readoutFrom(m)))
        .catch(() => {});
    }, 450);
    return () => {
      clearTimeout(id);
      ac.abort();
    };
  }, [cursor]);

  const range = cursor && site ? { km: haversineKm(site, { lat: cursor.lat, lon: cursor.lng }), deg: bearingDeg(site, { lat: cursor.lat, lon: cursor.lng }) } : null;

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-canvas/95 px-3 py-1.5 font-mono text-[11px] text-ink-2 tabular-nums">
      {!cursor ? (
        <span className="font-sans text-ink-3">{t("Move the pointer over a panel (or tap) to sample every panel at that spot.")}</span>
      ) : (
        <>
          <span className="text-ink">
            {cursor.lat.toFixed(4)}°, {cursor.lng.toFixed(4)}°
          </span>
          {model && <span title={t("Ground height")}>{f.height(model.elevation)}</span>}
          {range && site && (
            <span title={t("Range and bearing from the radar")}>
              {site.icao} {String(Math.round(range.deg)).padStart(3, "0")}° {Math.round(range.km / 1.852)} nm
            </span>
          )}
          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
          {values.map((v) => (
            <span key={v.label}>
              <span className="text-ink-3">{v.label}</span> <span className="text-ink">{v.text}</span>
            </span>
          ))}
          {model && (
            <>
              <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
              <span title={t("Model temperature / dew point")}>
                T {f.temp(model.t)} Td {f.temp(model.td)}
              </span>
              <span>CAPE {model.cape == null ? "—" : Math.round(model.cape)}</span>
              <span>CIN {model.cin == null ? "—" : Math.round(model.cin)}</span>
              <span title={t("0–3 km bulk shear")}>SHR03 {model.shear03 == null ? "—" : `${Math.round(model.shear03)} kt`}</span>
              <span title={t("Precipitable water")}>PWAT {f.precip(model.pwat)}</span>
            </>
          )}
        </>
      )}
    </div>
  );
}
