import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/community/auth-form";
import { SubpageShell } from "@/components/shell/subpage-shell";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <SubpageShell width="max-w-md">
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </SubpageShell>
  );
}
