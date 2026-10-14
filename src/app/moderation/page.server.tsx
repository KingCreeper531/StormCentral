import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModerationQueue } from "@/components/community/moderation-queue";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { T } from "@/components/ui/t";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Moderation", robots: { index: false } };

/** The moderators' review queue. Anyone else gets a 404, so the page doesn't advertise itself. */
export default async function ModerationPage() {
  const user = await getSessionUser();
  if (!user?.moderator) notFound();
  return (
    <SubpageShell width="max-w-3xl">
      <header className="mb-5 sm:mb-6">
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">
          <T>Moderation</T>
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          <T>Reported reports, comments and accounts, oldest first. Keep closes the reports and shows the content again; Remove deletes it for everyone.</T>
        </p>
      </header>
      <ModerationQueue />
    </SubpageShell>
  );
}
