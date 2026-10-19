import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Feed } from "@/components/community/feed";
import { ProfileActions } from "@/components/community/profile-actions";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { Avatar, Stat } from "@/components/ui/misc";
import { Panel } from "@/components/ui/panel";
import { T } from "@/components/ui/t";
import { getSessionUser } from "@/lib/auth/session";
import { badgeFor, rankOf, tierFor, TIERS } from "@/lib/community";
import { getProfile } from "@/lib/server/community-repo";
import { blockedBetween, isBlocking } from "@/lib/server/moderation-repo";
import { HiddenFeedNote, JoinedLine, RankProgress, SuspensionNote } from "./profile-text";

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

export default async function ProfilePage({ params }: Params) {
  const { username } = await params;
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) notFound();
  const [profile, viewer] = await Promise.all([getProfile(username), getSessionUser()]);
  if (!profile) notFound();
  const isSelf = viewer?.id === profile.id;
  const suspendedNow = profile.suspendedUntil != null;
  const iBlocked = !!viewer && !isSelf && (await isBlocking(viewer.id, profile.id));
  const separated = !!viewer && !isSelf && (iBlocked || (await blockedBetween(viewer.id, profile.id)));
  // Suspended accounts' reports are hidden from everyone but themselves and moderators.
  const showFeed = !separated && (!suspendedNow || isSelf || !!viewer?.moderator);
  // A granted Trusted Spotter ranks at least that; progress to the next rank still counts confirmations.
  const tier = tierFor(rankOf(profile));
  const badge = badgeFor(profile);
  const nextTier = [...TIERS].reverse().find((t) => t.min > rankOf(profile));

  return (
    <SubpageShell>
      <Panel as="section" aria-labelledby="profile-name" className="mb-6">
        <div className="flex items-center gap-4">
          <Avatar name={profile.displayName} hue={profile.avatarHue} src={profile.avatarUrl} size={56} />
          <div className="min-w-0 flex-1">
            <h1 id="profile-name" className="truncate text-xl font-semibold text-ink">
              {profile.displayName}
            </h1>
            <p className="truncate text-[13px] text-ink-3">
              <JoinedLine username={profile.username} createdAt={profile.createdAt} />
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: badge.color }} />
              <T>{badge.name}</T>
            </p>
          </div>
          <div className="self-start">
            <ProfileActions username={profile.username} displayName={profile.displayName} userId={profile.id} blocked={iBlocked} />
          </div>
        </div>
        {suspendedNow && (
          <p className="mt-3 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
            <SuspensionNote until={profile.suspendedUntil!} />
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-6">
          <div className="grid grid-cols-2 gap-4">
            <Stat label={<T>Reports</T>} value={profile.posts} />
            <Stat label={<T>Confirmations</T>} value={profile.reputation} />
          </div>
          <div className="min-w-0">
            <RankProgress reputation={profile.reputation} tier={tier} nextTier={nextTier} />
          </div>
        </div>
      </Panel>

      <h2 className="mb-3 text-sm font-semibold text-ink">
        <T>Reports</T>
      </h2>
      {showFeed ? (
        <Feed user={profile.username} />
      ) : (
        <p className="surface p-4 text-sm text-ink-2">
          <HiddenFeedNote blocked={iBlocked} separated={separated} displayName={profile.displayName} />
        </p>
      )}
    </SubpageShell>
  );
}
