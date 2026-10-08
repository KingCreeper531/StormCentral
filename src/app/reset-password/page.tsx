import type { Metadata } from "next";
import { Suspense } from "react";
import { CommunityUnavailable } from "@/components/community/community-unavailable";
import { ResetPasswordForm } from "@/components/community/password-forms";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { COMMUNITY_ENABLED } from "@/lib/platform";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <SubpageShell width="max-w-md">
      {COMMUNITY_ENABLED ? (
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      ) : (
        <CommunityUnavailable />
      )}
    </SubpageShell>
  );
}
