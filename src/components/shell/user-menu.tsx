"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOut, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { qk, useSession } from "@/hooks/queries";
import { Avatar } from "../ui/misc";

export function UserMenu() {
  const { data: user, isLoading } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  if (isLoading) return <span className="skeleton size-8 rounded-full" />;
  if (!user)
    return (
      <Link href="/login" className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition-transform hover:scale-[1.03]">
        Sign in
      </Link>
    );

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    qc.setQueryData(qk.session, null);
    void qc.invalidateQueries({ queryKey: ["posts"] });
    setOpen(false);
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="rounded-full ring-1 ring-white/15 transition hover:ring-white/40">
        <Avatar name={user.displayName} hue={user.avatarHue} size={32} />
        <span className="sr-only">Account menu</span>
      </button>
      {open && (
        <div role="menu" className="glass-strong absolute right-0 z-50 mt-2 w-52 rounded-2xl p-1.5 text-sm" onMouseLeave={() => setOpen(false)}>
          <p className="truncate px-3 pt-1.5 pb-2 text-xs text-ink-3">
            Signed in as <span className="font-semibold text-ink">@{user.username}</span>
          </p>
          <Link role="menuitem" href={`/u/${user.username}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-ink-2 hover:bg-white/10 hover:text-ink">
            <User className="size-4" /> Profile
          </Link>
          <button role="menuitem" type="button" onClick={signOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-ink-2 hover:bg-white/10 hover:text-ink">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
