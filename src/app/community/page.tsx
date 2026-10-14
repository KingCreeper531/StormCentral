import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CommunityUnavailable } from "@/components/community/community-unavailable";
import { Feed } from "@/components/community/feed";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { T } from "@/components/ui/t";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { AboutAside, AboutDetails } from "./about";

export const metadata: Metadata = {
  title: "Spotter network",
  description: "Weather reports from people on the ground, confirmed by other spotters nearby.",
};

export default function CommunityPage() {
  if (!COMMUNITY_ENABLED)
    return (
      <SubpageShell>
        <CommunityUnavailable />
      </SubpageShell>
    );
  return (
    <SubpageShell width="max-w-5xl">
      <header className="mb-5 sm:mb-6">
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">
          <T>Spotter network</T>
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          <T>Reports from people on the ground: hail size, flooding, funnel clouds and sky photos. Reports also appear on the radar map.</T>
        </p>
        <Link
          href="/community/scorecard"
          className="mt-2 inline-flex min-h-8 items-center gap-0.5 text-[13px] font-medium text-accent hover:underline pointer-coarse:min-h-11"
        >
          <T>Forecast scorecard</T>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          <AboutDetails />

          <Feed />
        </div>

        <AboutAside />
      </div>
    </SubpageShell>
  );
}
