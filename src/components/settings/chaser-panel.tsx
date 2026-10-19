"use client";

import { useNow } from "@/hooks/use-now";
import { parseStream, SHARE_HOURS, type ShareHours } from "@/lib/chasers";
import { useT } from "@/lib/i18n/use-t";
import { timeAgo } from "@/lib/time";
import { clockIn } from "@/lib/weather/view";
import { useAppStore } from "@/store/app-store";
import { useChaserStore } from "@/store/chaser-store";
import { Toggle } from "../ui/misc";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";

/**
 * Share my live position as a storm chaser (Account tab, signed in). Off by
 * default; the beacon in Providers does the sending while it's on.
 */
export function ChaserPanel() {
  const sharing = useChaserStore((s) => s.sharing);
  const hours = useChaserStore((s) => s.hours);
  const until = useChaserStore((s) => s.until);
  const status = useChaserStore((s) => s.status);
  const lastSentAt = useChaserStore((s) => s.lastSentAt);
  const setSharing = useChaserStore((s) => s.setSharing);
  const setHours = useChaserStore((s) => s.setHours);
  const stream = useChaserStore((s) => s.stream);
  const setStream = useChaserStore((s) => s.setStream);
  const streamOk = !stream.trim() || !!parseStream(stream);
  const showChasers = useAppStore((s) => s.radar.showChasers);
  const setRadar = useAppStore((s) => s.setRadar);
  const now = useNow(30_000);
  const t = useT();

  const state =
    status === "denied"
      ? t("Location permission is off. Allow it for Storm Central to share your position.")
      : status === "error"
        ? t("Couldn't send your position. Retrying with the next fix.")
        : status === "live" && lastSentAt
          ? t("Live: last sent {ago}.", { ago: timeAgo(lastSentAt, now, t) })
          : t("Waiting for a GPS fix.");

  return (
    <Panel title={t("Storm chasing")}>
      <Toggle label={t("Share my location as a storm chaser")} checked={sharing} onChange={(on) => setSharing(on)} />
      <p className="label mt-1">
        {t(
          "While this is on and Storm Central is open, signed-in spotters see your live position, speed and heading on the radar map. It turns off by itself after the time below, and your position is deleted when you stop or sign out.",
        )}
      </p>
      <div className="mt-3">
        <p className="label mb-1.5">{t("Stop sharing after")}</p>
        <Segmented<ShareHours>
          ariaLabel={t("Stop sharing after")}
          size="sm"
          stretch
          value={hours}
          onChange={(h) => setHours(h)}
          options={SHARE_HOURS.map((h) => ({ value: h, label: t.plural(h, "{n} hour", "{n} hours") }))}
        />
      </div>
      <div className="mt-3">
        <label htmlFor="chaser-stream" className="label mb-1.5 block">
          {t("Your YouTube live stream (optional)")}
        </label>
        <input
          id="chaser-stream"
          type="url"
          inputMode="url"
          value={stream}
          onChange={(e) => setStream(e.target.value)}
          placeholder="youtube.com/@yourchannel"
          aria-invalid={!streamOk}
          aria-describedby="chaser-stream-hint"
          className="h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent aria-[invalid=true]:border-nogo pointer-coarse:h-11 pointer-coarse:text-base"
        />
        <p id="chaser-stream-hint" className="label mt-1">
          {streamOk
            ? t("Your channel or a live video link. Spotters who tap your marker get a Watch live button.")
            : t("That isn't a YouTube channel or live video link.")}
        </p>
      </div>
      {sharing && until != null && (
        <p className="mt-3 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
          {t("Sharing until {time}.", { time: clockIn(undefined, until, t.locale) })} {state}
        </p>
      )}
      {!showChasers && (
        <p className="label mt-3">
          {t("To see other chasers, turn on Storm chasers in the radar's layers.")}{" "}
          <button type="button" className="text-ink-2 underline-offset-2 hover:underline" onClick={() => setRadar({ showChasers: true })}>
            {t("Turn on now")}
          </button>
        </p>
      )}
    </Panel>
  );
}
