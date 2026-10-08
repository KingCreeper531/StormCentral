import { ChevronDown, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CommunityUnavailable } from "@/components/community/community-unavailable";
import { Feed } from "@/components/community/feed";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { Panel } from "@/components/ui/panel";
import { TIERS } from "@/lib/community";
import { COMMUNITY_ENABLED } from "@/lib/platform";

export const metadata: Metadata = {
  title: "Spotter network",
  description: "Weather reports from people on the ground, confirmed by other spotters nearby.",
};

const PROSE = "text-[13px] leading-relaxed text-ink-2";

function HowItWorks() {
  return (
    <p className={PROSE}>
      If you are nearby and seeing the same conditions, press <span className="font-medium text-ink">Confirm</span> on a report. Confirmations
      raise the reporter&apos;s rank and move reliable reports up the Top 24&nbsp;h list.
    </p>
  );
}

function Ranks() {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="label pb-1.5 text-left font-normal">
            Rank
          </th>
          <th scope="col" className="label pb-1.5 text-right font-normal">
            Confirmations
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {[...TIERS].reverse().map((t) => (
          <tr key={t.name}>
            <td className="py-1.5 text-ink">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: t.color }} />
                {t.name}
              </span>
            </td>
            <td className="py-1.5 text-right text-ink-2 tabular">{t.min}+</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Privacy() {
  return (
    <p className={PROSE}>
      Report locations are rounded to about 1 km (half a mile) unless you choose to share precise GPS. Photo metadata, including GPS, is removed on your device and
      again on the server.
    </p>
  );
}

const ABOUT = [
  { title: "How confirmation works", Body: HowItWorks },
  { title: "Ranks", Body: Ranks },
  { title: "Privacy", Body: Privacy },
] as const;

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
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Spotter network</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Reports from people on the ground: hail size, flooding, funnel clouds and sky photos. Reports also appear on the radar map.
        </p>
        <Link
          href="/community/scorecard"
          className="mt-2 inline-flex min-h-8 items-center gap-0.5 text-[13px] font-medium text-accent hover:underline pointer-coarse:min-h-11"
        >
          Forecast scorecard
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          {/* Phones and tablets: the sidebar folds into one collapsed section above the feed. */}
          <details className="surface group overflow-hidden lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium text-ink select-none [&::-webkit-details-marker]:hidden">
              About the spotter network
              <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="divide-y divide-line border-t border-line">
              {ABOUT.map(({ title, Body }) => (
                <section key={title} className="p-4">
                  <h2 className="mb-2 text-sm font-semibold text-ink">{title}</h2>
                  <Body />
                </section>
              ))}
            </div>
          </details>

          <Feed />
        </div>

        <aside className="hidden space-y-4 lg:block" aria-label="About the spotter network">
          {ABOUT.map(({ title, Body }) => (
            <Panel key={title} title={title}>
              <Body />
            </Panel>
          ))}
        </aside>
      </div>
    </SubpageShell>
  );
}
