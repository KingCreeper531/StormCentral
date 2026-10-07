import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Feed } from "@/components/community/feed";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { Avatar } from "@/components/ui/misc";
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

  return (
    <SubpageShell>
      <header className="glass mb-6 flex flex-wrap items-center gap-5 rounded-[2rem] p-6">
        <Avatar name={profile.displayName} hue={profile.avatarHue} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{profile.displayName}</h1>
          <p className="text-sm text-ink-3">
            @{profile.username} · joined {new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-semibold">
            <span className="size-2 rounded-full" style={{ background: tier.color }} />
            {tier.name}
            {nextTier && <span className="font-normal text-ink-3">· {nextTier.min - profile.reputation} to {nextTier.name}</span>}
          </p>
        </div>
        <dl className="flex gap-6 text-center">
          <div>
            <dt className="text-[11px] tracking-wide text-ink-3 uppercase">Reports</dt>
            <dd className="text-2xl font-semibold">{profile.posts}</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-ink-3 uppercase">Confirmations</dt>
            <dd className="text-2xl font-semibold">{profile.reputation}</dd>
          </div>
        </dl>
      </header>
      <Feed user={profile.username} />
    </SubpageShell>
  );
}
