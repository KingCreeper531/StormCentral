"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { qk } from "@/hooks/queries";
import { WeatherIcon } from "../ui/weather-icon";

/** Only same-site relative paths are allowed as post-login redirects. */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  const input = "w-full rounded-2xl bg-white/[0.05] px-4 py-3 text-sm outline-none ring-1 ring-white/10 placeholder:text-ink-3 focus:ring-accent";

  return (
    <div className="glass mx-auto w-full max-w-md rounded-[2rem] p-7">
      <div className="mb-6 text-center">
        <WeatherIcon name={mode === "login" ? "clear-night" : "isolated-thunderstorms-day"} size={84} className="mx-auto" />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{mode === "login" ? "Welcome back, spotter" : "Join the Spotter Network"}</h1>
        <p className="mt-1 text-sm text-ink-3">
          {mode === "login" ? "Sign in to report weather and verify observations." : "Share ground truth, verify reports and build your reputation."}
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        {mode === "register" ? (
          <>
            <input name="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" autoComplete="username" placeholder="Username" aria-label="Username" className={input} />
            <input name="displayName" maxLength={40} autoComplete="nickname" placeholder="Display name (optional)" aria-label="Display name" className={input} />
            <input name="email" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" className={input} />
            <input name="password" type="password" required minLength={10} autoComplete="new-password" placeholder="Password (10+ characters)" aria-label="Password" className={input} />
          </>
        ) : (
          <>
            <input name="identifier" required autoComplete="username" placeholder="Username or email" aria-label="Username or email" className={input} />
            <input name="password" type="password" required autoComplete="current-password" placeholder="Password" aria-label="Password" className={input} />
          </>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-nogo/10 px-3 py-2 text-xs text-ink ring-1 ring-nogo/30">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-semibold text-black transition hover:scale-[1.01] disabled:opacity-50">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="mt-5 text-center text-xs text-ink-3">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-accent hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already a spotter?{" "}
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-accent hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
