"use client";

import { X } from "lucide-react";
import { useState } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import { stormEta } from "@/lib/science/storm-motion";
import { useAppStore } from "@/store/app-store";

export function AlertDetail({ alert: a, now, onClose }: { alert: WeatherAlert; now: number; onClose: () => void }) {
  const loc = useAppStore((s) => s.location);
  const [expanded, setExpanded] = useState(false);
  const eta = a.motion ? stormEta(a.motion, loc, 15, now) : null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="glass-strong max-h-[60vh] w-full overflow-y-auto rounded-2xl p-4" role="dialog" aria-label={a.event}>
      <div className="flex items-start gap-3">
        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: a.color, boxShadow: `0 0 12px ${a.color}` }} />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{a.event}</h3>
          <p className="text-xs text-ink-3">
            {a.sender} · issued {time(a.sent)} · until {time(a.ends ?? a.expires)}
          </p>
        </div>
        <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-full hover:bg-white/10" aria-label="Close alert">
          <X className="size-4" />
        </button>
      </div>
      {a.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {a.tags.map((t) => (
            <span key={t} className="rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide" style={{ background: `${a.color}30` }}>
              {t}
            </span>
          ))}
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {a.hazards.maxHail && (
          <div className="rounded-xl bg-white/[0.04] px-2.5 py-1.5">
            <dt className="text-ink-3">Max hail</dt>
            <dd className="font-semibold">{a.hazards.maxHail}&quot;</dd>
          </div>
        )}
        {a.hazards.maxWind && (
          <div className="rounded-xl bg-white/[0.04] px-2.5 py-1.5">
            <dt className="text-ink-3">Max wind</dt>
            <dd className="font-semibold">{a.hazards.maxWind}</dd>
          </div>
        )}
        {a.hazards.tornado && (
          <div className="rounded-xl bg-white/[0.04] px-2.5 py-1.5">
            <dt className="text-ink-3">Tornado</dt>
            <dd className="font-semibold capitalize">{a.hazards.tornado.toLowerCase()}</dd>
          </div>
        )}
        {a.motion && (
          <div className="rounded-xl bg-white/[0.04] px-2.5 py-1.5">
            <dt className="text-ink-3">Storm motion</dt>
            <dd className="font-semibold">
              {Math.round(a.motion.headingDeg)}° at {a.motion.speedKt} kt
            </dd>
          </div>
        )}
        {eta != null && (
          <div className="col-span-2 rounded-xl px-2.5 py-1.5 ring-1" style={{ background: `${a.color}1f`, borderColor: a.color }}>
            <dt className="text-ink-2">Projected arrival at {loc.name}</dt>
            <dd className="text-base font-semibold">~{Math.round(eta)} min</dd>
          </div>
        )}
      </dl>
      {a.headline && <p className="mt-3 text-sm font-medium text-ink">{a.headline}</p>}
      <p className={`mt-2 text-xs leading-relaxed whitespace-pre-line text-ink-2 ${expanded ? "" : "line-clamp-6"}`}>{a.description}</p>
      {a.instruction && expanded && <p className="mt-2 rounded-xl bg-white/[0.04] p-2.5 text-xs leading-relaxed whitespace-pre-line text-ink">{a.instruction}</p>}
      <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-2 text-xs font-semibold text-accent hover:underline">
        {expanded ? "Show less" : "Full text & safety instructions"}
      </button>
    </div>
  );
}
