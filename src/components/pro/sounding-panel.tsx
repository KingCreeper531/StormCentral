"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useFormat } from "@/hooks/use-format";
import { useT } from "@/lib/i18n/use-t";
import type { LatLon } from "@/lib/geo";
import { modelPoint } from "@/lib/pro/model";
import type { Motion } from "@/lib/pro/storm-tools";
import { analyze, atPressure, MS_TO_KT, windFrom, type ParcelResult } from "@/lib/pro/thermo";
import { Segmented } from "../ui/segmented";
import { Hodograph } from "./hodograph";
import { SkewT } from "./skew-t";

type ParcelKind = "sb" | "ml" | "mu";

const n0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString());
const n1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : (Math.round(v * 10) / 10).toFixed(1));

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[4px] bg-surface-2 px-2 py-1" title={hint}>
      <div className="truncate text-[10px] text-ink-3">{label}</div>
      <div className="font-mono text-[12px] text-ink tabular-nums">{value}</div>
    </div>
  );
}

/** NSHARP-style sounding: Skew-T, hodograph and the severe-weather indices for a point. */
export function SoundingPanel({ point, motion }: { point: LatLon; motion: Motion | null }) {
  const t = useT();
  const f = useFormat();
  const [kind, setKind] = useState<ParcelKind>("ml");
  const key = `${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
  const q = useQuery({ queryKey: ["pro-sounding", key], queryFn: ({ signal }) => modelPoint(point, signal), staleTime: 10 * 60_000, retry: 1 });
  const m = q.data;
  const a = useMemo(() => (m?.sounding ? analyze(m.sounding) : null), [m]);

  if (q.isLoading) return <p className="p-3 text-[12px] text-ink-3">{t("Loading the model profile…")}</p>;
  if (q.isError || !m) return <p className="p-3 text-[12px] text-caution">{t("Couldn't load the model profile. Try again in a moment.")}</p>;
  if (!m.sounding || !a) return <p className="p-3 text-[12px] text-ink-3">{t("The model has too few levels above the ground here.")}</p>;

  const parcel: ParcelResult = a[kind];
  const lclZ = atPressure(m.sounding.levels, parcel.lclP, (l) => l.z);
  const lclAgl = lclZ == null ? null : lclZ - m.sounding.sfcZ;
  const rm = a.storm?.rm;
  const rmW = rm ? windFrom(rm.u, rm.v) : null;
  const obs = motion ? { u: ((motion.speedKt / MS_TO_KT) * Math.sin((motion.headingDeg * Math.PI) / 180)), v: (motion.speedKt / MS_TO_KT) * Math.cos((motion.headingDeg * Math.PI) / 180) } : null;
  const kt = (ms: number | null) => (ms == null ? "—" : `${Math.round(ms * MS_TO_KT)} kt`);
  const valid = new Date(m.valid);

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
        <span className="font-mono">
          {m.lat.toFixed(2)}, {m.lon.toFixed(2)} · {f.height(m.elevation)}
        </span>
        <span>
          {t("Model valid {time}", { time: `${String(valid.getUTCHours()).padStart(2, "0")}Z` })}
        </span>
      </div>
      <SkewT sounding={m.sounding} parcel={parcel} />
      <Segmented<ParcelKind>
        ariaLabel={t("Parcel")}
        size="sm"
        stretch
        value={kind}
        onChange={setKind}
        options={[
          { value: "sb", label: t("Surface") },
          { value: "ml", label: t("Mixed layer") },
          { value: "mu", label: t("Most unstable") },
        ]}
      />
      <div className="grid grid-cols-3 gap-1.5">
        <Cell label="SBCAPE" value={`${n0(a.sb.cape)} J/kg`} />
        <Cell label="MLCAPE" value={`${n0(a.ml.cape)} J/kg`} />
        <Cell label="MUCAPE" value={`${n0(a.mu.cape)} J/kg`} />
        <Cell label="SBCIN" value={`${n0(a.sb.cin)} J/kg`} />
        <Cell label="MLCIN" value={`${n0(a.ml.cin)} J/kg`} />
        <Cell label="MUCIN" value={`${n0(a.mu.cin)} J/kg`} />
        <Cell label={t("LCL ({parcel})", { parcel: kind.toUpperCase() })} value={lclAgl == null ? "—" : f.height(lclAgl)} />
        <Cell label="LI" value={a.li == null ? "—" : `${n1(a.li)} °C`} hint={t("Lifted index of the surface parcel at 500 hPa")} />
        <Cell label="PWAT" value={f.precip(a.pwat)} />
        <Cell label={t("Lapse 0–3 km")} value={`${n1(a.lapse03)} °C/km`} />
        <Cell label={t("Lapse 700–500")} value={`${n1(a.lapse700500)} °C/km`} />
        <Cell label={t("Shear 0–1 km")} value={kt(a.shear01)} />
        <Cell label={t("Shear 0–3 km")} value={kt(a.shear03)} />
        <Cell label={t("Shear 0–6 km")} value={kt(a.shear06)} />
        <Cell label="SRH 0–1 km" value={`${n0(a.srh01)} m²/s²`} />
        <Cell label="SRH 0–3 km" value={`${n0(a.srh03)} m²/s²`} />
        <Cell label={t("Bunkers RM")} value={rmW ? `${String(Math.round(rmW.dir)).padStart(3, "0")}° / ${Math.round(rmW.spd * MS_TO_KT)} kt` : "—"} />
        <Cell label={t("Critical angle")} value={a.criticalAngle == null ? "—" : `${a.criticalAngle}°`} />
      </div>
      <div className="mx-auto max-w-[280px]">
        <Hodograph sounding={m.sounding} rm={a.storm?.rm} lm={a.storm?.lm} mean={a.storm?.mean} observed={obs} />
      </div>
      <p className="text-[10px] leading-snug text-ink-3">{t("Model profile from Open-Meteo (HRRR/NAM/GFS blend) for the current hour, not an observed sounding. SRH uses the Bunkers right mover.")}</p>
    </div>
  );
}
