"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { qk } from "@/hooks/queries";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";
import { Field, INPUT } from "./auth-form";

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
}

function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setPending(true);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  return { error, setError, pending, run };
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-xs text-ink-2">
      {error}
    </p>
  );
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-go/30 bg-go/10 px-3 py-2.5 text-sm text-ink">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-go" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

const CARD = "surface mx-auto w-full max-w-[400px] p-5 sm:mt-6 sm:p-6";

/** /forgot-password: email a one-time reset link. */
export function ForgotPasswordForm() {
  const uid = useId();
  const { error, pending, run } = useSubmit();
  const [sent, setSent] = useState(false);
  return (
    <div className={CARD}>
      <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-2">Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</p>
      {sent ? (
        <div className="mt-5">
          <Done>If an account uses that email, a reset link is on its way. It works once, for 30 minutes. Check your spam folder too.</Done>
        </div>
      ) : (
        <form
          className="mt-5 space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const email = String(new FormData(e.currentTarget).get("email") ?? "");
            void run(async () => {
              await post("/api/auth/forgot", { email });
              setSent(true);
            });
          }}
        >
          <Field id={`${uid}-email`} label="Email">
            <input id={`${uid}-email`} name="email" type="email" required autoComplete="email" inputMode="email" className={INPUT} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" variant="primary" disabled={pending} className="w-full">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-5 border-t border-line pt-4 text-[13px] text-ink-3">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

/** /reset-password?token=…: choose a new password from an emailed link. */
export function ResetPasswordForm() {
  const uid = useId();
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const { error, setError, pending, run } = useSubmit();

  if (!token) {
    return (
      <div className={CARD}>
        <h1 className="text-xl font-semibold text-ink">Reset link missing</h1>
        <p className="mt-1 text-sm text-ink-2">Open the link from your email again, or ask for a new one.</p>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Send a new reset link
        </Link>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
      <p className="mt-1 text-sm text-ink-2">You&apos;ll be signed in here and signed out on your other devices.</p>
      <form
        className="mt-5 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const password = String(f.get("password") ?? "");
          if (password !== String(f.get("confirm") ?? "")) return setError("The two passwords don't match");
          void run(async () => {
            await post("/api/auth/reset", { token, password });
            await qc.invalidateQueries({ queryKey: qk.session });
            router.push("/");
            router.refresh();
          });
        }}
      >
        <Field id={`${uid}-password`} label="New password" hint="At least 10 characters.">
          <input id={`${uid}-password`} name="password" type="password" required minLength={10} autoComplete="new-password" className={INPUT} />
        </Field>
        <Field id={`${uid}-confirm`} label="Type it again">
          <input id={`${uid}-confirm`} name="confirm" type="password" required minLength={10} autoComplete="new-password" className={INPUT} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save new password
        </Button>
      </form>
      {error?.includes("expired") && (
        <Link href="/forgot-password" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Send a new reset link
        </Link>
      )}
    </div>
  );
}

/** Settings → Account: change password while signed in. */
export function ChangePasswordPanel() {
  const uid = useId();
  const { error, setError, pending, run } = useSubmit();
  const [done, setDone] = useState(false);
  return (
    <Panel title="Password" subtitle="Changing it signs you out on your other devices">
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const password = String(f.get("password") ?? "");
          if (password !== String(f.get("confirm") ?? "")) return setError("The two new passwords don't match");
          setDone(false);
          void run(async () => {
            await post("/api/auth/password", { current: String(f.get("current") ?? ""), password });
            form.reset();
            setDone(true);
          });
        }}
      >
        <Field id={`${uid}-current`} label="Current password">
          <input id={`${uid}-current`} name="current" type="password" required autoComplete="current-password" className={INPUT} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${uid}-password`} label="New password" hint="At least 10 characters.">
            <input id={`${uid}-password`} name="password" type="password" required minLength={10} autoComplete="new-password" className={INPUT} />
          </Field>
          <Field id={`${uid}-confirm`} label="Type it again">
            <input id={`${uid}-confirm`} name="confirm" type="password" required minLength={10} autoComplete="new-password" className={INPUT} />
          </Field>
        </div>
        <ErrorText error={error} />
        {done && <Done>Password changed.</Done>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Change password
          </Button>
          <Link href="/forgot-password" className="text-[13px] text-ink-2 hover:text-ink hover:underline">
            Forgot your current password?
          </Link>
        </div>
      </form>
    </Panel>
  );
}
