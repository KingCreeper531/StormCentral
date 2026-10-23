"use client";

import { useT } from "@/lib/i18n/use-t";
import { DEFAULT_LOOK, isDefault, LOWER_KEYS, TICKER_KEYS, type BroadcastLook, type LowerSize, type TickerSpeed } from "@/lib/broadcast/look";
import { useBroadcastStore } from "@/store/broadcast-store";
import { Button } from "../ui/button";
import { Toggle } from "../ui/misc";
import { Segmented } from "../ui/segmented";

const FIELD =
  "h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong";
const LABEL = "mb-1.5 block text-[12px] font-medium text-ink-2";

type ColorKey = { [K in keyof BroadcastLook]: BroadcastLook[K] extends string | null ? K : never }[keyof BroadcastLook];

/** A colour well; for a colour that can follow the accent, a way back to it. */
function ColorField({ k, label, followsAccent }: { k: ColorKey; label: string; followsAccent?: boolean }) {
  const t = useT();
  const value = useBroadcastStore((s) => s.look[k]) as string | null;
  const accent = useBroadcastStore((s) => s.accent);
  const setLook = useBroadcastStore((s) => s.setLook);
  return (
    <div className="flex min-h-9 items-center gap-2">
      <label className="flex flex-1 items-center gap-2 text-[13px] text-ink-2">
        <input type="color" value={value ?? accent} onChange={(e) => setLook({ [k]: e.target.value })} className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-transparent" aria-label={label} />
        {label}
      </label>
      {followsAccent ? (
        value !== null && (
          <Button size="sm" variant="ghost" onClick={() => setLook({ [k]: null })}>
            {t("Use the accent")}
          </Button>
        )
      ) : (
        value !== DEFAULT_LOOK[k] && (
          <Button size="sm" variant="ghost" onClick={() => setLook({ [k]: DEFAULT_LOOK[k] })}>
            {t("Reset")}
          </Button>
        )
      )}
    </div>
  );
}

function SectionHead({ title, sub, keys }: { title: string; sub: string; keys: readonly (keyof BroadcastLook)[] }) {
  const t = useT();
  const look = useBroadcastStore((s) => s.look);
  const resetLook = useBroadcastStore((s) => s.resetLook);
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <p className="text-[12px] text-ink-3">{sub}</p>
      </div>
      {!isDefault(look, keys) && (
        <Button size="sm" variant="ghost" onClick={() => resetLook(keys)}>
          {t("Reset all")}
        </Button>
      )}
    </div>
  );
}

/** The lower third: its words when no warning is picked, colours, size and shape. */
export function LowerThirdControls() {
  const t = useT();
  const look = useBroadcastStore((s) => s.look);
  const setLook = useBroadcastStore((s) => s.setLook);
  return (
    <section className="space-y-3">
      <SectionHead title={t("Lower third")} sub={t("A warning you pick keeps its own words and colour.")} keys={LOWER_KEYS} />
      <label className="block">
        <span className={LABEL}>{t("Title")}</span>
        <input className={FIELD} value={look.lowerTitle} maxLength={60} onChange={(e) => setLook({ lowerTitle: e.target.value })} placeholder={t("The place's name")} />
      </label>
      <label className="block">
        <span className={LABEL}>{t("Second line")}</span>
        <input className={FIELD} value={look.lowerSubtitle} maxLength={80} onChange={(e) => setLook({ lowerSubtitle: e.target.value })} placeholder={t("The radar product")} />
      </label>
      <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-4">
        <ColorField k="lowerColor" label={t("Bar colour")} followsAccent />
        <ColorField k="lowerBg" label={t("Background")} />
        <ColorField k="lowerText" label={t("Text colour")} />
        <label className="flex min-h-9 items-center gap-3 text-[13px] text-ink-2">
          <span>{t("Opacity")}</span>
          <input
            type="range"
            min={40}
            max={100}
            step={5}
            value={Math.round(look.lowerOpacity * 100)}
            onChange={(e) => setLook({ lowerOpacity: Number(e.target.value) / 100 })}
            className="min-w-0 flex-1 accent-[var(--color-accent)]"
            aria-label={t("Background opacity")}
          />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-2">{t("Size")}</span>
        <Segmented<LowerSize>
          ariaLabel={t("Lower third size")}
          size="sm"
          value={look.lowerSize}
          onChange={(lowerSize) => setLook({ lowerSize })}
          options={[
            { value: "s", label: t("Small") },
            { value: "m", label: t("Medium") },
            { value: "l", label: t("Large") },
          ]}
        />
      </div>
      <Toggle label={t("Square corners")} checked={look.lowerSquare} onChange={(lowerSquare) => setLook({ lowerSquare })} />
      <Toggle label={t("Narrower, on the left")} checked={look.lowerCompact} onChange={(lowerCompact) => setLook({ lowerCompact })} />
    </section>
  );
}

/** The warnings ticker: its label, a message of your own, colours, size and speed. */
export function TickerControls() {
  const t = useT();
  const look = useBroadcastStore((s) => s.look);
  const setLook = useBroadcastStore((s) => s.setLook);
  return (
    <section className="space-y-3">
      <SectionHead title={t("Ticker")} sub={t("The strip along the bottom with every warning in effect.")} keys={TICKER_KEYS} />
      <label className="block">
        <span className={LABEL}>{t("Label")}</span>
        <input className={FIELD} value={look.tickerLabel} maxLength={24} onChange={(e) => setLook({ tickerLabel: e.target.value })} placeholder={t("WARNINGS")} />
      </label>
      <label className="block">
        <span className={LABEL}>{t("Your message")}</span>
        <input className={FIELD} value={look.tickerMessage} maxLength={140} onChange={(e) => setLook({ tickerMessage: e.target.value })} placeholder={t("Runs before the warnings, e.g. your website")} />
      </label>
      <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-4">
        <ColorField k="tickerLabelColor" label={t("Label colour")} followsAccent />
        <ColorField k="tickerBg" label={t("Background")} />
        <ColorField k="tickerText" label={t("Text colour")} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-2">{t("Speed")}</span>
        <Segmented<TickerSpeed>
          ariaLabel={t("Ticker speed")}
          size="sm"
          value={look.tickerSpeed}
          onChange={(tickerSpeed) => setLook({ tickerSpeed })}
          options={[
            { value: "slow", label: t("Slow") },
            { value: "normal", label: t("Normal") },
            { value: "fast", label: t("Fast") },
          ]}
        />
      </div>
      <Toggle label={t("Larger text")} checked={look.tickerLarge} onChange={(tickerLarge) => setLook({ tickerLarge })} />
      <Toggle label={t("Warning codes (TOR, SVR, FFW)")} checked={look.tickerCodes} onChange={(tickerCodes) => setLook({ tickerCodes })} />
    </section>
  );
}
