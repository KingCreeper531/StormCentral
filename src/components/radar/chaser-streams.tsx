"use client";

import { ExternalLink, MapPin, X } from "lucide-react";
import { useState } from "react";
import type { ChaserStreamsResponse, LiveChaserStream } from "@/lib/chaser-streams";
import type { ChaserDto } from "@/lib/chasers";
import { useT } from "@/lib/i18n/use-t";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button, buttonClass } from "../ui/button";
import { ErrorNote } from "../ui/misc";

const LIVE_PILL = "rounded-[3px] bg-nogo px-1 text-[10px] leading-4 font-bold tracking-wide text-white uppercase";

/**
 * The radar's Chasers panel: storm chasers live on YouTube right now, to
 * watch here, and where they are when they share their position in Storm
 * Central; then every chaser channel on the list, to open on YouTube.
 */
export function ChaserStreams({
  data,
  pending,
  error,
  chaserFor,
  onShowOnMap,
  now,
}: {
  data: ChaserStreamsResponse | undefined;
  pending: boolean;
  error: unknown;
  /** The Storm Central chaser streaming this, when they're sharing their position. */
  chaserFor: (s: LiveChaserStream) => ChaserDto | null;
  onShowOnMap: (c: ChaserDto) => void;
  now: number;
}) {
  const t = useT();
  const [playing, setPlaying] = useState<string | null>(null);
  const live = data?.live ?? [];
  const current = live.find((s) => s.videoId === playing) ?? null;
  const liveNames = new Set(live.map((s) => s.channelName.toLowerCase()));
  const offline = (data?.channels ?? []).filter((c) => !liveNames.has(c.name.toLowerCase()));

  if (error)
    return (
      <div className="p-4">
        <ErrorNote error={error} what="the storm chaser streams" />
      </div>
    );
  if (pending && !data) return <p className="label px-4 pt-3">{t("Loading")}</p>;

  return (
    <div className="pb-2">
      {current && (
        <div className="space-y-2 border-b border-line p-3">
          <iframe
            key={current.videoId}
            src={current.embed}
            title={t("{name}'s live stream", { name: current.channelName })}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="aspect-video w-full rounded-[var(--radius-control)] border border-line bg-black"
          />
          <p className="text-[13px] leading-snug font-semibold text-ink">{current.channelName}</p>
          <p className="line-clamp-2 text-xs text-ink-2">{current.title}</p>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPlaying(null)}>
              <X className="size-4" aria-hidden />
              {t("Close player")}
            </Button>
            <a href={current.url} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
              <ExternalLink className="size-4" aria-hidden />
              {t("Open on YouTube")}
            </a>
            {chaserFor(current) && (
              <Button variant="ghost" size="sm" onClick={() => onShowOnMap(chaserFor(current)!)}>
                <MapPin className="size-4" aria-hidden />
                {t("Show on map")}
              </Button>
            )}
          </div>
        </div>
      )}

      {data?.liveStatus !== false && (
        <section>
          <h3 className="label px-4 pt-3 pb-1">{t.plural(live.length, "Live now · {n} chaser", "Live now · {n} chasers")}</h3>
          {!live.length ? (
            <p className="px-4 pb-2 text-[13px] text-ink-3">{t("No storm chasers on the list are live right now.")}</p>
          ) : (
            <ul>
              {live.map((s) => {
                const chaser = chaserFor(s);
                return (
                  <li key={s.videoId}>
                    <button
                      type="button"
                      onClick={() => setPlaying(s.videoId)}
                      aria-pressed={playing === s.videoId}
                      className={cn("flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-surface-2", playing === s.videoId && "bg-surface-2")}
                    >
                      <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-[4px] border border-line bg-black">
                        {s.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.thumbnail} alt="" loading="lazy" className="size-full object-cover" />
                        )}
                        <span className={cn(LIVE_PILL, "absolute top-1 left-1")}>{t("Live")}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{s.channelName}</span>
                        <span className="line-clamp-2 text-xs text-ink-2">{s.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
                          {s.viewers != null && <span className="tabular">{t.plural(s.viewers, "{n} watching", "{n} watching")}</span>}
                          {s.startedAt && <span>{t("started {ago}", { ago: timeAgo(Date.parse(s.startedAt), now, t) })}</span>}
                          {chaser && (
                            <span className="inline-flex items-center gap-0.5 text-ink-2">
                              <MapPin className="size-3" aria-hidden />
                              {t("On the map")}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {offline.length > 0 && (
        <section className="border-t border-line">
          <h3 className="label px-4 pt-3 pb-1">{data?.liveStatus === false ? t("Storm chasers on YouTube") : t("Not live")}</h3>
          <ul className="px-4 pb-1">
            {offline.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 py-1.5 text-[13px] text-ink-2 hover:text-ink">
                  <span className="truncate">{c.name}</span>
                  <ExternalLink className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="label border-t border-line px-4 pt-3">
        {t(
          "Streams belong to the chasers. Chasers who share their position in Storm Central (Settings → Account) show on the map with LIVE when they stream. Never drive toward a storm to meet anyone.",
        )}
      </p>
    </div>
  );
}
