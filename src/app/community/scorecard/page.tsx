import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CommunityUnavailable } from "@/components/community/community-unavailable";
import { Scorecard } from "@/components/community/scorecard";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { COMMUNITY_ENABLED } from "@/lib/platform";

export const metadata: Metadata = {
  title: "Forecast scorecard",
  description: "How often the forecast model showed the weather that spotters reported.",
};

/**
 * Static page shell; the data comes from /api/community/scorecard on the
 * client, so the static export (Android) never touches the database.
 */
export default function ScorecardPage() {
  if (!COMMUNITY_ENABLED)
    return (
      <SubpageShell>
        <CommunityUnavailable />
      </SubpageShell>
    );
  return (
    <SubpageShell width="max-w-3xl">
      <header className="mb-5 sm:mb-6">
        <Link
          href="/community"
          className="-ml-1 inline-flex min-h-8 items-center gap-0.5 rounded-[var(--radius-control)] pr-1 text-[13px] text-ink-3 hover:text-ink pointer-coarse:min-h-11"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Spotter network
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink sm:text-2xl">Forecast vs. reality</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">How often the forecast model showed the weather that spotters reported.</p>
      </header>
      <Scorecard />
    </SubpageShell>
  );
}
