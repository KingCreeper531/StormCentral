import type { Metadata } from "next";
import { CommunityUnavailable } from "@/components/community/community-unavailable";
import { ForgotPasswordForm } from "@/components/community/password-forms";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { COMMUNITY_ENABLED } from "@/lib/platform";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return <SubpageShell width="max-w-md">{COMMUNITY_ENABLED ? <ForgotPasswordForm /> : <CommunityUnavailable />}</SubpageShell>;
}
