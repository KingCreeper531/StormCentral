"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { qk } from "@/hooks/queries";
import { Button } from "../ui/button";

/** Only same-site relative paths are allowed as post-login redirects. */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/** DESIGN.md input recipe; 16 px text on touch devices so iOS doesn't zoom on focus. */
const INPUT =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent pointer-coarse:h-11 pointer-coarse:text-base";

function Field({ id, label, hint, optional, children }: { id: string; label: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
          {label}
        </label>
        {optional && <span className="label">Optional</span>}
      </div>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="label mt-1.5">
          {hint}
        </p>
      )}
    </div>
  );
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      await qc.invalidateQueries({ queryKey: qk.session });
      await qc.invalidateQueries({ queryKey: ["posts"] });
      router.push(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const login = mode === "login";

  return (
    <div className="surface mx-auto w-full max-w-[400px] p-5 sm:mt-6 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">{login ? "Sign in" : "Create an account"}</h1>
      <p className="mt-1 text-sm text-ink-2">
        {login ? "Post weather reports and confirm observations from other spotters." : "An account lets you post weather reports and confirm other spotters' observations."}
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
        {mode === "register" ? (
          <>
            <Field id={id("username")} label="Username" hint="3 to 24 letters, numbers or underscores.">
              <input
                id={id("username")}
                name="username"
                required
                minLength={3}
                maxLength={24}
                pattern="[A-Za-z0-9_]+"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={`${id("username")}-hint`}
                className={INPUT}
              />
            </Field>
            <Field id={id("displayName")} label="Display name" optional>
              <input id={id("displayName")} name="displayName" maxLength={40} autoComplete="nickname" className={INPUT} />
            </Field>
            <Field id={id("email")} label="Email">
              <input id={id("email")} name="email" type="email" required autoComplete="email" inputMode="email" className={INPUT} />
            </Field>
            <Field id={id("password")} label="Password" hint="At least 10 characters.">
              <input
                id={id("password")}
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                aria-describedby={`${id("password")}-hint`}
                className={INPUT}
              />
            </Field>
          </>
        ) : (
          <>
            <Field id={id("identifier")} label="Username or email">
              <input
                id={id("identifier")}
                name="identifier"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={INPUT}
              />
            </Field>
            <Field id={id("password")} label="Password">
              <input id={id("password")} name="password" type="password" required autoComplete="current-password" className={INPUT} />
            </Field>
          </>
        )}
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-xs text-ink-2">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {login ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-5 border-t border-line pt-4 text-[13px] text-ink-3">
        {login ? (
          <>
            No account yet?{" "}
            <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-accent hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-accent hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
