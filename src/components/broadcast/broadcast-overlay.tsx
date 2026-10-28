"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useNow } from "@/hooks/use-now";
import type { WeatherAlert } from "@/lib/api/types";
import { countdown, tickerItems, warningCounts, type LowerThird } from "@/lib/broadcast/graphics";
import { lowerScale, tickerSeconds, withAlpha } from "@/lib/broadcast/look";
import { overlayInsets, type Insets } from "@/lib/broadcast/pro-view";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
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
 * broadcast settings. With `onInsets`, it says how far the graphics reach in
 * from the top and bottom whenever that changes (the Pro view keeps its
 * toolbars clear of them).
 */
export function BroadcastOverlay({
  warnings,
  lower,
  lowerKey,
  timeZone,
  onInsets,
}: {
  warnings: readonly WeatherAlert[];
  lower: LowerThird;
  lowerKey: string;
  timeZone?: string;
  onInsets?: (insets: Insets) => void;
}) {
  const t = useT();
  const s = useBroadcastStore();
  const root = useRef<HTMLDivElement>(null);
  const last = useRef<Insets | null>(null);
  // After every render (turning a part on or off moves the others without resizing them) and on every resize.
  // Layout offsets, not on-screen boxes, so the lower third's rise animation doesn't count.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !onInsets) return;
    const measure = () => {
      const boxes = [...el.children].map((c) => ({ top: (c as HTMLElement).offsetTop, height: (c as HTMLElement).offsetHeight }));
      const next = overlayInsets(boxes, el.clientHeight);
      if (last.current?.top === next.top && last.current.bottom === next.bottom) return;
      last.current = next;
      onInsets(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  });
  const counts = useMemo(() => warningCounts(warnings, t), [warnings, t]);
  const ticker = useMemo(() => tickerItems(warnings, timeZone, t), [warnings, timeZone, t]);
  const L = s.look;
  const tickerChars = ticker.reduce((n, i) => n + i.text.length + 8, 0) + L.tickerMessage.length + 8;
  const tickerOn = s.parts.ticker;
  const tickerH = L.tickerLarge ? 46 : 36;
  const bottom = tickerOn ? tickerH + 10 : 18;
  const k = lowerScale(L.lowerSize);
  const tickerFont = L.tickerLarge ? 19 : 15;

  return (
    <div ref={root} className="bc" aria-hidden>
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
        <div
          key={lowerKey}
          className={cn(
            "bc-rise absolute left-[18px] flex items-stretch overflow-hidden border border-white/[0.09] shadow-[0_10px_30px_rgba(0,0,0,0.45)]",
            L.lowerCompact ? "w-[min(60%,720px)] max-sm:right-[18px] max-sm:w-auto" : "right-[18px]",
          )}
          style={{ bottom, height: Math.round(78 * k), borderRadius: L.lowerSquare ? 0 : 14, background: withAlpha(L.lowerBg, L.lowerOpacity), color: L.lowerText }}
        >
          <div className="w-2.5 shrink-0" style={{ background: lower.color }} />
          <div className="flex min-w-0 flex-1 flex-col justify-center px-[18px]">
            <div className="truncate leading-tight font-black tracking-[0.6px]" style={{ fontSize: `min(${Math.round(27 * k)}px, 6vw)` }}>
              {lower.title}
            </div>
            <div className="mt-0.5 truncate font-semibold opacity-80" style={{ fontSize: `min(${Math.round(16.5 * k)}px, 4vw)` }}>
              {lower.subtitle}
            </div>
          </div>
          {lower.ends && (
            <div className="flex flex-col items-end justify-center border-l border-white/[0.07] bg-gradient-to-r from-transparent to-white/[0.05] px-[18px]">
              <small className="text-[10.5px] font-extrabold tracking-[1.8px] opacity-60">{t("ENDS IN")}</small>
              <b className="font-black" style={{ color: lower.color, fontSize: Math.round(26 * k) }}>
                <Countdown until={lower.ends} />
              </b>
            </div>
          )}
        </div>
      )}

      {tickerOn && (
        <div className="absolute inset-x-0 bottom-0 flex border-t border-white/[0.08]" style={{ height: tickerH, background: L.tickerBg }}>
          <div
            className="z-[1] flex shrink-0 items-center px-3.5 font-black tracking-[2px] text-white"
            style={{ background: L.tickerLabelColor ?? s.accent, boxShadow: `8px 0 16px ${L.tickerBg}`, fontSize: L.tickerLarge ? 14 : 12 }}
          >
            {L.tickerLabel.trim() || t("WARNINGS")}
          </div>
          <div className="relative flex-1 overflow-hidden">
            <div
              className="bc-run absolute top-0 left-0 flex h-full items-center whitespace-nowrap"
              style={{ "--d": `${tickerSeconds(tickerChars, L.tickerSpeed)}s`, color: L.tickerText, fontSize: tickerFont } as React.CSSProperties}
            >
              {L.tickerMessage.trim() && <span className="mr-[34px] font-bold">{L.tickerMessage.trim()}</span>}
              {ticker.length ? (
                ticker.map((it, i) => (
                  <span key={i} className="mr-[34px] inline-flex items-center gap-2 font-semibold">
                    {L.tickerCodes && (
                      <em className="rounded-[4px] px-1.5 py-0.5 text-[11px] font-black tracking-[1px] text-[#0a0d14] not-italic" style={{ background: it.color }}>
                        {it.code}
                      </em>
                    )}
                    {it.text}
                  </span>
                ))
              ) : (
                <span className="mr-[34px] font-semibold opacity-70">{t("No tornado, severe thunderstorm or flash flood warnings in effect.")}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
