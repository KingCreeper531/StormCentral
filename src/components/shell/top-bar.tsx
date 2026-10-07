"use client";

import { MapPin, Megaphone, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { Button } from "../ui/button";
import { GUTTER } from "./chrome";
import { ModeSwitcher } from "./mode-switcher";
import { UnitsToggle } from "./units-toggle";
import { UserMenu } from "./user-menu";

/**
 * Fixed, solid top bar (`--topbar-h`). Phones: logo, location/search,
 * report and account. md+: adds the mode tabs; lg+: the spotter network link
 * and the units switch inline (below lg they live in the account menu).
 */
export function TopBar() {
  const location = useAppStore((s) => s.location);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const setComposerOpen = useAppStore((s) => s.setComposerOpen);
  const pathname = usePathname();
  const onCommunity = pathname.startsWith("/community");

  return (
    <header className="fixed inset-x-0 top-0 z-40 h-[var(--topbar-h)] border-b border-line bg-canvas">
      <div className={cn("mx-auto flex h-full max-w-[1600px] items-center gap-2 md:gap-3 lg:gap-4", GUTTER)}>
        <Link
          href="/"
          aria-label="StormCentral home"
          className="-ml-1 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] px-1 pointer-coarse:h-11 pointer-coarse:min-w-11"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={24} height={24} className="size-6" />
          <span className="hidden text-sm font-semibold text-ink min-[1440px]:inline">StormCentral</span>
        </Link>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label={`Location: ${location.name}. Search places`}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2.5 text-left text-[13px] transition-colors hover:border-line-strong pointer-coarse:h-11 md:w-36 md:flex-none lg:w-60"
        >
          <MapPin className="size-4 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{location.name}</span>
          <Search className="size-3.5 shrink-0 text-ink-3 lg:hidden" aria-hidden />
          <kbd className="hidden rounded-[4px] border border-line px-1 font-mono text-[11px] leading-4 text-ink-3 lg:inline">⌘K</kbd>
        </button>

        <ModeSwitcher className="-mb-px hidden self-stretch md:flex" />

        <div className="ml-auto flex shrink-0 items-center gap-1 self-stretch sm:gap-2">
          {/* Same current-page treatment as the mode tabs: an accent rule on the bar's bottom edge. */}
          <Link
            href="/community"
            aria-current={onCommunity ? "page" : undefined}
            className={cn(
              "relative -mb-px hidden items-center self-stretch px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors lg:flex",
              onCommunity ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            Spotter network
            {onCommunity && <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-0.5 bg-accent" />}
          </Link>
          <UnitsToggle className="hidden lg:inline-flex" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setComposerOpen(true)}
            aria-label="Report weather"
            title="Report weather"
            className="w-8 px-0 pointer-coarse:min-w-11 lg:w-auto lg:px-2.5"
          >
            <Megaphone className="size-4" aria-hidden />
            <span className="hidden lg:inline">Report</span>
          </Button>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
