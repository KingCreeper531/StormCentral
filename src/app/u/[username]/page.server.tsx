import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Feed } from "@/components/community/feed";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { Meter } from "@/components/ui/meter";
import { Avatar, Stat } from "@/components/ui/misc";
import { Panel } from "@/components/ui/panel";
import { tierFor, TIERS } from "@/lib/community";
import { getProfile } from "@/lib/server/community-repo";

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

export default async function ProfilePage({ params }: Params) {
  const { username } = await params;
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) notFound();
  const profile = await getProfile(username);
  if (!profile) notFound();
  const tier = tierFor(profile.reputation);
  const nextTier = [...TIERS].reverse().find((t) => t.min > profile.reputation);
  const joined = new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const toNext = nextTier ? nextTier.min - profile.reputation : 0;

  return (
    <SubpageShell>
      <Panel as="section" aria-labelledby="profile-name" className="mb-6">
        <div className="flex items-center gap-4">
          <Avatar name={profile.displayName} hue={profile.avatarHue} size={56} />
          <div className="min-w-0 flex-1">
            <h1 id="profile-name" className="truncate text-xl font-semibold text-ink">
              {profile.displayName}
            </h1>
            <p className="truncate text-[13px] text-ink-3">
              @{profile.username} · Joined {joined}
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: tier.color }} />
              {tier.name}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-6">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Reports" value={profile.posts} />
            <Stat label="Confirmations" value={profile.reputation} />
          </div>
          <div className="min-w-0">
            {nextTier ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="label">Progress to {nextTier.name}</p>
                  <p className="text-xs text-ink-2 tabular">
                    {profile.reputation} / {nextTier.min}
                  </p>
                </div>
                <Meter
                  value={profile.reputation - tier.min}
                  max={nextTier.min - tier.min}
                  color={tier.color}
                  label={`Progress to ${nextTier.name}`}
                  className="mt-2"
                />
                <p className="label mt-1.5">
                  {toNext} more confirmation{toNext === 1 ? "" : "s"} to reach {nextTier.name}.
                </p>
              </>
            ) : (
              <>
                <p className="label">Rank</p>
                <p className="mt-0.5 text-sm text-ink-2">Highest rank reached.</p>
              </>
            )}
          </div>
        </div>
      </Panel>

      <h2 className="mb-3 text-sm font-semibold text-ink">Reports</h2>
      <Feed user={profile.username} />
    </SubpageShell>
  );
}
