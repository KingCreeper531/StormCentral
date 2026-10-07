import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/community/auth-form";
import { SubpageShell } from "@/components/shell/subpage-shell";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <SubpageShell width="max-w-md">
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </SubpageShell>
  );
}
