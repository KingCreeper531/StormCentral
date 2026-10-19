"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useFormat } from "@/hooks/use-format";
import { CHASER_STALE_MS, type ChaserDto } from "@/lib/chasers";
import { badgeFor } from "@/lib/community";
import { compassPoint } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { IconButton } from "../ui/button";
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
  fetchedAt,
  now,
  onClose,
  hideTitle = false,
  className,
}: {
  chaser: ChaserDto;
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
      <p className="label">
        {c.mine
          ? t("You're sharing your live position with signed-in spotters. Stop anytime in Settings → Account.")
          : t("Shared live by this spotter while they chase; it updates about every minute. Never drive toward a storm to meet anyone.")}
      </p>
    </div>
  );
}
