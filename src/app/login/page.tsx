import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/community/auth-form";
import { CommunityUnavailable } from "@/components/community/community-unavailable";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { COMMUNITY_ENABLED } from "@/lib/platform";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <SubpageShell width="max-w-md">
      {COMMUNITY_ENABLED ? (
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      ) : (
        <CommunityUnavailable />
      )}
    </SubpageShell>
  );
}
