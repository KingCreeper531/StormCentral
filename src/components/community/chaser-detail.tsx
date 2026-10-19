"use client";

import { ExternalLink, Play, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormat } from "@/hooks/use-format";
import type { LiveChaserStream } from "@/lib/chaser-streams";
import { CHASER_STALE_MS, type ChaserDto, type LiveStream } from "@/lib/chasers";
import { badgeFor } from "@/lib/community";
import { compassPoint } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button, buttonClass, IconButton } from "../ui/button";
import { Avatar } from "../ui/misc";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-lg leading-6 font-medium break-words text-ink tabular">{children}</dd>
    </div>
  );
}

/** A storm chaser picked on the map: who, how fast and which way, and how fresh the position is. */
export function ChaserDetail({
  chaser: c,
  live,
  fetchedAt,
  now,
  onClose,
  hideTitle = false,
  className,
}: {
  chaser: ChaserDto;
  /** Their linked stream, when it's live right now: plays that video. */
  live?: LiveChaserStream | null;
  /** When the list was fetched; `ageSec` is as of then. */
  fetchedAt: number;
  now: number;
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const t = useT();
  const fmt = useFormat();
  const badge = badgeFor(c);
  const sentAt = fetchedAt - c.ageSec * 1000;
  const stale = now - sentAt > CHASER_STALE_MS;
  const miles = fmt.units.distance === "mi";
  const speed = c.speedKmh == null ? "—" : `${Math.round(miles ? c.speedKmh / 1.609344 : c.speedKmh)} ${miles ? "mph" : "km/h"}`;
  const moving = c.heading != null && (c.speedKmh == null || c.speedKmh >= 3);
  const profile = `/u/${c.username}`;
  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      {!hideTitle && (
        <div className="flex items-start gap-3">
          <Link href={profile} tabIndex={-1} aria-hidden className="shrink-0">
            <Avatar name={c.displayName} hue={c.avatarHue} src={c.avatarUrl} size={36} />
          </Link>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base leading-6 font-semibold text-ink">
              <Link href={profile} className="hover:underline">
                {c.displayName}
              </Link>
            </h3>
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
              <span className="truncate">@{c.username}</span>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: badge.color }} />
              <span className="shrink-0">{t(badge.name)}</span>
            </p>
          </div>
          {onClose && (
            <IconButton label={t("Close chaser")} size="sm" onClick={onClose} className="-mt-1 -mr-2">
              <X className="size-4" aria-hidden />
            </IconButton>
          )}
        </div>
      )}
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
        <Fact label={t("Speed")}>{moving ? speed : t("Parked")}</Fact>
        <Fact label={t("Heading")}>{moving ? t(compassPoint(c.heading!)) : "—"}</Fact>
        <Fact label={t("Updated")}>
          <span className={cn(stale && "text-ink-3")}>{timeAgo(sentAt, now, t)}</span>
        </Fact>
      </dl>
      {c.stream && <WatchLive stream={live ? { url: live.url, embed: live.embed } : c.stream} name={c.displayName} live={!!live} />}
      <p className="label">
        {c.mine
          ? t("You're sharing your live position with signed-in spotters. Stop anytime in Settings → Account.")
          : t("Shared live by this spotter while they chase; it updates about every minute. Never drive toward a storm to meet anyone.")}
      </p>
    </div>
  );
}

/**
 * The chaser's YouTube stream: plays here when YouTube allows embedding it (a
 * video or a channel id), otherwise opens on YouTube.
 */
function WatchLive({ stream, name, live }: { stream: LiveStream; name: string; live: boolean }) {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  const open = (
    <a href={stream.url} target="_blank" rel="noopener noreferrer" className={buttonClass(stream.embed ? "ghost" : "primary", "sm")}>
      {stream.embed ? <ExternalLink className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
      {stream.embed ? t("Open on YouTube") : t("Watch live")}
    </a>
  );
  if (!stream.embed) return <div>{open}</div>;
  return (
    <div className="space-y-2">
      {playing ? (
        <iframe
          src={stream.embed}
          title={t("{name}'s live stream", { name })}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="aspect-video w-full rounded-[var(--radius-control)] border border-line bg-black"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {live && !playing && <span className="rounded-[3px] bg-nogo px-1 text-[10px] leading-4 font-bold tracking-wide text-white uppercase">{t("Live")}</span>}
        <Button variant={playing ? "ghost" : "primary"} size="sm" onClick={() => setPlaying((p) => !p)}>
          {playing ? <X className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {playing ? t("Close player") : t("Watch live")}
        </Button>
        {open}
      </div>
    </div>
  );
}
