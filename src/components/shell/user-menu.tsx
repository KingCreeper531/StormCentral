"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleUser, LogIn, LogOut, User, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { qk, useSession } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import { buttonClass } from "../ui/button";
import { Avatar } from "../ui/misc";
import { UnitsToggle } from "./units-toggle";

const ITEM =
  "flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 pointer-coarse:h-11";

const DIVIDER = "my-1 border-t border-line";

/**
 * Account control at the right end of the top bar.
 * - Signed in: avatar button that opens the account menu.
 * - Signed out, lg+: a "Sign in" link (the units and spotter link sit inline in the bar).
 * - Signed out, below lg: an account icon that opens the same menu with Sign in,
 *   Create account, Spotter network and units, which have no other entry point there.
 * The menu is a disclosure panel (links plus a units radio group), not role="menu".
 */
export function UserMenu() {
  const { data: user, isLoading } = useSession();
  const qc = useQueryClient();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Close on an outside press (works for touch, unlike mouseleave) and on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (isLoading)
    return (
      <span aria-hidden className="grid size-9 place-items-center pointer-coarse:size-11">
        <span className="size-7 rounded-full bg-surface-2" />
      </span>
    );

  const onLogin = pathname.startsWith("/login");
  const onRegister = pathname.startsWith("/register");
  // Return to the current page after signing in (auth pages keep their own `next`).
  const next = onLogin || onRegister ? "" : `?next=${encodeURIComponent(pathname)}`;
  const close = () => setOpen(false);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    qc.setQueryData(qk.session, null);
    void qc.invalidateQueries({ queryKey: ["posts"] });
    setOpen(false);
  };

  // Up/down arrows move between the panel's controls.
  const onPanelKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const units = (
    <div className="flex items-center justify-between gap-3 py-1 pr-1 pl-2.5">
      <span className="text-[13px] text-ink-2">Units</span>
      <UnitsToggle />
    </div>
  );

  const spotterLink = (
    <Link href="/community" onClick={close} aria-current={pathname.startsWith("/community") ? "page" : undefined} className={ITEM}>
      <Users className="size-4 shrink-0" aria-hidden /> Spotter network
    </Link>
  );

  return (
    <>
      {!user && !onLogin && !onRegister && (
        <Link href={`/login${next}`} className={buttonClass("ghost", "sm", "hidden lg:inline-flex")}>
          Sign in
        </Link>
      )}

      <div ref={rootRef} className={cn("relative", !user && "lg:hidden")}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={user ? "Account menu" : "Account"}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className={cn(
            "grid size-9 place-items-center rounded-[var(--radius-control)] transition-colors hover:bg-surface-2 pointer-coarse:size-11",
            !user && (open ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"),
          )}
        >
          {user ? <Avatar name={user.displayName} hue={user.avatarHue} size={28} /> : <CircleUser className="size-5" aria-hidden />}
        </button>

        {open && (
          <div
            id={panelId}
            onKeyDown={onPanelKey}
            className="absolute top-full right-0 z-50 mt-2 w-56 rounded-[var(--radius-panel)] border border-line bg-surface-1 p-1"
          >
            {user ? (
              <>
                <div className="mb-1 border-b border-line px-2.5 pt-1.5 pb-2">
                  <p className="truncate text-[13px] font-medium text-ink">{user.displayName}</p>
                  <p className="truncate text-xs text-ink-3">@{user.username}</p>
                </div>
                <Link href={`/u/${user.username}`} onClick={close} className={ITEM}>
                  <User className="size-4 shrink-0" aria-hidden /> Profile
                </Link>
                {spotterLink}
                {/* lg+ has the units switch inline in the bar. */}
                <div className="lg:hidden">
                  <div className={DIVIDER} />
                  {units}
                </div>
                <div className={DIVIDER} />
                <button type="button" onClick={signOut} className={ITEM}>
                  <LogOut className="size-4 shrink-0" aria-hidden /> Sign out
                </button>
              </>
            ) : (
              <>
                {!onLogin && (
                  <Link href={`/login${next}`} onClick={close} className={ITEM}>
                    <LogIn className="size-4 shrink-0" aria-hidden /> Sign in
                  </Link>
                )}
                {!onRegister && (
                  <Link href={`/register${next}`} onClick={close} className={ITEM}>
                    <UserPlus className="size-4 shrink-0" aria-hidden /> Create account
                  </Link>
                )}
                {spotterLink}
                <div className={DIVIDER} />
                {units}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
