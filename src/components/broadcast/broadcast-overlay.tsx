"use client";

import { useMemo } from "react";
import { useNow } from "@/hooks/use-now";
import type { WeatherAlert } from "@/lib/api/types";
import { countdown, tickerItems, warningCounts, type LowerThird } from "@/lib/broadcast/graphics";
import { useT } from "@/lib/i18n/use-t";
import { fmtIn } from "@/lib/weather/view";
import { useBroadcastStore } from "@/store/broadcast-store";

/** The station's logo, or the app's icon. */
export function StationLogo({ className }: { className?: string }) {
  const logo = useBroadcastStore((s) => s.logo);
  // eslint-disable-next-line @next/next/no-img-element -- a data: URL or the static icon; next/image adds nothing here.
  return <img src={logo ?? "/icon.svg"} alt="" className={className} />;
}

function Clock({ timeZone }: { timeZone?: string }) {
  const t = useT();
  const now = useNow(1000);
  const time = useMemo(() => fmtIn(timeZone, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }, t.locale), [timeZone, t]);
  const date = useMemo(() => fmtIn(timeZone, { weekday: "long", month: "long", day: "numeric" }, t.locale), [timeZone, t]);
  const parts = time.formatToParts(now);
  const zone = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const clock = parts
    .filter((p) => p.type !== "timeZoneName")
    .map((p) => p.value)
    .join("")
    .trim();
  return (
    <div className="border-b border-white/[0.07] px-3.5 pt-2.5 pb-2">
      <b className="text-[26px] font-extrabold tracking-[0.5px]">
        {clock}
        <span className="ml-1.5 text-[13px] font-bold tracking-[1px] text-[#9aa4b8]">{zone}</span>
      </b>
      <small className="block text-[12px] font-semibold text-[#9aa4b8]">{date.format(now)}</small>
    </div>
  );
}

function Countdown({ until }: { until: string }) {
  const now = useNow(1000);
  return <>{countdown(until, now)}</>;
}

/**
 * The on-air graphics over the map in broadcast mode: the station bug, the
 * clock with the active-warnings counts, the lower third (with a countdown
 * for a warning) and the warnings ticker. Each part can be turned off in
 * broadcast settings.
 */
export function BroadcastOverlay({ warnings, lower, lowerKey, timeZone }: { warnings: readonly WeatherAlert[]; lower: LowerThird; lowerKey: string; timeZone?: string }) {
  const t = useT();
  const s = useBroadcastStore();
  const counts = useMemo(() => warningCounts(warnings, t), [warnings, t]);
  const ticker = useMemo(() => tickerItems(warnings, timeZone, t), [warnings, timeZone, t]);
  const tickerChars = ticker.reduce((n, i) => n + i.text.length + 8, 0);
  const tickerOn = s.parts.ticker;
  const bottom = tickerOn ? 46 : 18;

  return (
    <div className="bc" aria-hidden>
      {s.parts.bug && (
        <div className="bc-glass absolute top-4 left-[18px] flex items-center gap-3 rounded-[14px] py-2 pr-3.5 pl-2">
          <StationLogo className="size-10 rounded-[10px] object-contain" />
          <div className="min-w-0">
            <b className="block max-w-[22rem] truncate text-[17px] font-extrabold tracking-[2.5px] uppercase">{s.name || "Storm Central"}</b>
            <div className="mt-[3px] flex items-center gap-2">
              {s.live && (
                <span className="inline-flex items-center gap-1.5 rounded-[5px] px-2 py-[3px] text-[11px] font-extrabold tracking-[1.8px] text-white" style={{ background: s.accent }}>
                  <i className="bc-live-dot size-[7px] rounded-full bg-white" />
                  {t("LIVE")}
                </span>
              )}
              {s.tagline && <small className="max-w-[16rem] truncate text-[11.5px] font-semibold tracking-[0.4px] text-[#9aa4b8]">{s.tagline}</small>}
            </div>
          </div>
        </div>
      )}

      {(s.parts.clock || s.parts.counts) && (
        <div className="bc-glass absolute top-4 right-[18px] w-[236px] overflow-hidden rounded-[14px] max-sm:hidden">
          {s.parts.clock && <Clock timeZone={timeZone} />}
          {s.parts.counts && (
            <div className="px-3.5 pt-2 pb-2.5">
              <h6 className="mb-1.5 text-[10.5px] font-extrabold tracking-[1.8px] text-[#9aa4b8]">{t("ACTIVE WARNINGS")}</h6>
              {counts.length ? (
                counts.map((c) => (
                  <div key={c.code} className="my-1 flex items-center gap-2.5">
                    <span className="min-w-[42px] rounded-[5px] py-[3px] text-center text-[12px] font-black tracking-[1px] text-[#0a0d14]" style={{ background: c.color }}>
                      {c.code}
                    </span>
                    <span className="flex-1 text-[12.5px] font-semibold text-[#cfd5e2]">{c.label}</span>
                    <span className="text-[20px] font-extrabold">{c.n}</span>
                  </div>
                ))
              ) : (
                <p className="text-[13px] font-semibold text-[#cfd5e2]">{t("None in effect")}</p>
              )}
            </div>
          )}
        </div>
      )}

      {s.parts.lower && (
        <div key={lowerKey} className="bc-glass bc-rise absolute right-[18px] left-[18px] flex h-[78px] items-stretch overflow-hidden rounded-[14px]" style={{ bottom }}>
          <div className="w-2.5 shrink-0" style={{ background: lower.color }} />
          <div className="min-w-0 flex-1 px-[18px] pt-[11px]">
            <div className="truncate text-[27px] font-black tracking-[0.6px] max-sm:text-[20px]">{lower.title}</div>
            <div className="mt-0.5 truncate text-[16.5px] font-semibold text-[#cfd5e2] max-sm:text-[13px]">{lower.subtitle}</div>
          </div>
          {lower.ends && (
            <div className="flex flex-col items-end justify-center border-l border-white/[0.07] bg-gradient-to-r from-transparent to-white/[0.05] px-[18px]">
              <small className="text-[10.5px] font-extrabold tracking-[1.8px] text-[#9aa4b8]">{t("ENDS IN")}</small>
              <b className="text-[26px] font-black" style={{ color: lower.color }}>
                <Countdown until={lower.ends} />
              </b>
            </div>
          )}
        </div>
      )}

      {tickerOn && (
        <div className="absolute inset-x-0 bottom-0 flex h-9 border-t border-white/[0.08] bg-[#050810]">
          <div className="z-[1] flex shrink-0 items-center px-3.5 text-[12px] font-black tracking-[2px] shadow-[8px_0_16px_#050810]" style={{ background: s.accent }}>
            {t("WARNINGS")}
          </div>
          <div className="relative flex-1 overflow-hidden">
            <div className="bc-run absolute top-0 left-0 flex h-9 items-center whitespace-nowrap" style={{ "--d": `${Math.max(30, Math.round(tickerChars / 9))}s` } as React.CSSProperties}>
              {ticker.length ? (
                ticker.map((it, i) => (
                  <span key={i} className="mr-[34px] inline-flex items-center gap-2 text-[15px] font-semibold text-[#e8ecf4]">
                    <em className="rounded-[4px] px-1.5 py-0.5 text-[11px] font-black tracking-[1px] text-[#0a0d14] not-italic" style={{ background: it.color }}>
                      {it.code}
                    </em>
                    {it.text}
                  </span>
                ))
              ) : (
                <span className="mr-[34px] text-[15px] font-semibold text-[#8f99ad]">{t("No tornado, severe thunderstorm or flash flood warnings in effect.")}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
