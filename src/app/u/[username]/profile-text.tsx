"use client";

import { Meter } from "@/components/ui/meter";
import { suspensionText, TIERS } from "@/lib/community";
import { useT } from "@/lib/i18n/use-t";

/** The profile page's text that needs the app language (the page itself renders on the server). */

export function JoinedLine({ username, createdAt }: { username: string; createdAt: string | number }) {
  const t = useT();
  const joined = new Date(createdAt).toLocaleDateString(t.locale, { month: "long", year: "numeric" });
  return (
    <>
      @{username} · {t("Joined {date}", { date: joined })}
    </>
  );
}

export function SuspensionNote({ until }: { until: number }) {
  const t = useT();
  return <>{suspensionText(until, t)}</>;
}

type Tier = (typeof TIERS)[number];

export function RankProgress({ reputation, tier, nextTier }: { reputation: number; tier: Tier; nextTier: Tier | undefined }) {
  const t = useT();
  if (!nextTier)
    return (
      <>
        <p className="label">{t("Rank")}</p>
        <p className="mt-0.5 text-sm text-ink-2">{t("Highest rank reached.")}</p>
      </>
    );
  const name = t(nextTier.name);
  const toNext = nextTier.min - reputation;
  const progress = t("Progress to {rank}", { rank: name });
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="label">{progress}</p>
        <p className="text-xs text-ink-2 tabular">
          {reputation} / {nextTier.min}
        </p>
      </div>
      <Meter value={reputation - tier.min} max={nextTier.min - tier.min} color={tier.color} label={progress} className="mt-2" />
      <p className="label mt-1.5">
        {t.plural(toNext, "{n} more confirmation to reach {rank}.", "{n} more confirmations to reach {rank}.", { rank: name })}
      </p>
    </>
  );
}

export function HiddenFeedNote({ blocked, separated, displayName }: { blocked: boolean; separated: boolean; displayName: string }) {
  const t = useT();
  return (
    <>
      {blocked
        ? t("You blocked {name}. Unblock them from the menu above to see their reports.", { name: displayName })
        : separated
          ? t("You can't see this account's reports.")
          : t("This account's reports are hidden while it is suspended.")}
    </>
  );
}
