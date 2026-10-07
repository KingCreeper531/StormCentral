import type { Metadata } from "next";
import { Feed } from "@/components/community/feed";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { TIERS } from "@/lib/community";

export const metadata: Metadata = {
  title: "Spotter Network",
  description: "Ground-truth weather reports from the StormCentral community — verified by fellow spotters.",
};

export default function CommunityPage() {
  return (
    <SubpageShell width="max-w-5xl">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <header className="mb-5">
            <p className="text-[11px] font-medium tracking-[0.14em] text-ink-3 uppercase">Community</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Spotter Network</h1>
            <p className="mt-1 text-sm text-ink-2">Real observations from real people — hail sizes, flooding, funnel clouds and sky photos. Reports appear on the radar map in Severe mode.</p>
          </header>
          <Feed />
        </div>
        <aside className="space-y-4">
          <section className="glass rounded-[var(--radius-pane)] p-5">
            <h2 className="text-sm font-semibold">How verification works</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              When you can confirm someone&apos;s report — you&apos;re nearby and seeing the same thing — tap <span className="text-ink">I can confirm</span>. Confirmations build the reporter&apos;s reputation and float reliable reports to the top.
            </p>
          </section>
          <section className="glass rounded-[var(--radius-pane)] p-5">
            <h2 className="text-sm font-semibold">Spotter ranks</h2>
            <ul className="mt-3 space-y-2 text-xs">
              {[...TIERS].reverse().map((t) => (
                <li key={t.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: t.color }} />
                    {t.name}
                  </span>
                  <span className="text-ink-3 tabular">{t.min}+ confirmations</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="glass rounded-[var(--radius-pane)] p-5 text-xs leading-relaxed text-ink-2">
            <h2 className="text-sm font-semibold text-ink">Privacy</h2>
            <p className="mt-2">Report locations are rounded to ~1 km unless you opt in to precise GPS, and photo metadata (including GPS) is stripped on your device and again on the server.</p>
          </section>
        </aside>
      </div>
    </SubpageShell>
  );
}
