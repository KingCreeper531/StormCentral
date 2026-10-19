"use client";

import { useT } from "@/lib/i18n/use-t";
import type { WeatherAlert } from "@/lib/api/types";
import { tagLabel } from "@/lib/alerts";
import { ibwDetails, TIER_COLOR, type IbwTier } from "@/lib/pro/ibw";

const TIER_LABEL: Record<IbwTier, string> = { base: "Base", considerable: "Considerable", destructive: "Destructive", catastrophic: "Catastrophic" };

const zulu = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z` : "—";
};

/**
 * Hazard polygon inspector: the warning's Impact-Based Warning tags (damage
 * threat, detection, hail and wind) and its HAZARD / SOURCE / IMPACT text.
 */
export function IbwInspector({ alert, onClose }: { alert: WeatherAlert; onClose: () => void }) {
  const t = useT();
  const d = ibwDetails(alert);
  return (
    <div className="space-y-3 p-3 text-[12px]">
      <div className="flex items-start gap-2">
        <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: alert.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">{t(alert.event)}</h3>
          <p className="truncate text-ink-3" title={alert.areaDesc}>
            {alert.areaDesc}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">
          {t("Close")}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-sm px-1.5 py-0.5 font-semibold text-black" style={{ background: TIER_COLOR[d.tier] }}>
          {t("Damage threat: {tier}", { tier: t(TIER_LABEL[d.tier]) })}
        </span>
        {d.detection && (
          <span className={`rounded-sm px-1.5 py-0.5 font-semibold ${d.detection === "observed" ? "bg-nogo text-white" : "bg-surface-3 text-ink"}`}>
            {t(d.detection === "observed" ? "Tornado observed" : d.detection === "possible" ? "Tornado possible" : "Radar indicated")}
          </span>
        )}
        {alert.tags
          .filter((tag) => !["OBSERVED", "TORNADO POSSIBLE", "CONSIDERABLE", "DESTRUCTIVE"].includes(tag))
          .map((tag) => (
            <span key={tag} className="rounded-sm bg-nogo/20 px-1.5 py-0.5 font-semibold text-nogo">
              {t(tagLabel(tag))}
            </span>
          ))}
      </div>
      <dl className="grid grid-cols-3 gap-1.5">
        <div className="rounded-[4px] bg-surface-2 px-2 py-1">
          <dt className="text-[10px] text-ink-3">{t("Max hail")}</dt>
          <dd className="font-mono">{d.maxHail ? `${d.maxHail} in` : "—"}</dd>
        </div>
        <div className="rounded-[4px] bg-surface-2 px-2 py-1">
          <dt className="text-[10px] text-ink-3">{t("Max wind")}</dt>
          <dd className="font-mono">{d.maxWind ?? "—"}</dd>
        </div>
        <div className="rounded-[4px] bg-surface-2 px-2 py-1">
          <dt className="text-[10px] text-ink-3">{t("Expires")}</dt>
          <dd className="font-mono">{zulu(alert.expires)}</dd>
        </div>
      </dl>
      {alert.motion && (
        <p className="font-mono text-ink-2">
          {t("Motion")}: {String(Math.round((alert.motion.headingDeg + 180) % 360)).padStart(3, "0")}° / {Math.round(alert.motion.speedKt)} kt
        </p>
      )}
      {[
        ["HAZARD", d.hazard],
        ["SOURCE", d.source],
        ["IMPACT", d.impact],
      ].map(([k, v]) =>
        v ? (
          <div key={k}>
            <div className="text-[10px] font-semibold tracking-wide text-ink-3">{k}</div>
            <p className="leading-snug text-ink">{v}</p>
          </div>
        ) : null,
      )}
      {!d.hazard && !d.source && !d.impact && <p className="text-ink-3">{t("This product has no HAZARD / SOURCE / IMPACT section.")}</p>}
    </div>
  );
}
