"use client";

import { MapPin, Megaphone, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/use-t";
import { COMMUNITY_ENABLED } from "@/lib/platform";
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
  const t = useT();
  const location = useAppStore((s) => s.location);
  // GPS without a town name is stored as "My location".
  const placeName = location.name === "My location" ? t("My location") : location.name;
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const setComposerOpen = useAppStore((s) => s.setComposerOpen);
  const pathname = usePathname();
  const onCommunity = pathname.startsWith("/community");

  return (
    <header data-chrome className="fixed inset-x-0 top-0 z-40 h-[var(--topbar-h)] border-b border-line bg-canvas pt-[env(safe-area-inset-top)]">
      <div className={cn("mx-auto flex h-full max-w-[1600px] items-center gap-2 md:gap-3 lg:gap-4", GUTTER)}>
        <Link
          href="/"
          aria-label={t("Storm Central home")}
          className="-ml-1 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] px-1 pointer-coarse:h-11 pointer-coarse:min-w-11"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={24} height={24} className="size-6" />
          <span className="hidden text-sm font-semibold text-ink min-[1440px]:inline">Storm Central</span>
        </Link>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label={t("Location: {name}. Search places", { name: placeName })}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2.5 text-left text-[13px] transition-colors hover:border-line-strong pointer-coarse:h-11 md:w-36 md:flex-none lg:w-60"
        >
          <MapPin className="size-4 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{placeName}</span>
          <Search className="size-3.5 shrink-0 text-ink-3 lg:hidden" aria-hidden />
          <kbd className="hidden rounded-[4px] border border-line px-1 font-mono text-[11px] leading-4 text-ink-3 lg:inline">⌘K</kbd>
        </button>

        <ModeSwitcher className="-mb-px hidden self-stretch md:flex" />

        <div className="ml-auto flex shrink-0 items-center gap-1 self-stretch sm:gap-2">
          {/* Same current-page treatment as the mode tabs: an accent rule on the bar's bottom edge. */}
          {COMMUNITY_ENABLED && (
            <Link
              href="/community"
              aria-current={onCommunity ? "page" : undefined}
              className={cn(
                "relative -mb-px hidden items-center self-stretch px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors lg:flex",
                onCommunity ? "text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              {t("Spotter network")}
              {onCommunity && <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-0.5 bg-accent" />}
            </Link>
          )}
          <UnitsToggle className="hidden lg:inline-flex" />
          {COMMUNITY_ENABLED && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setComposerOpen(true)}
              aria-label={t("Report weather")}
              title={t("Report weather")}
              className="w-8 px-0 pointer-coarse:min-w-11 lg:w-auto lg:px-2.5"
            >
              <Megaphone className="size-4" aria-hidden />
              <span className="hidden lg:inline">{t("Report")}</span>
            </Button>
          )}
          <Link
            href="/settings"
            aria-label={t("Settings")}
            title={t("Settings")}
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:size-11",
              pathname.startsWith("/settings") ? "bg-surface-2 text-ink" : "text-ink-2",
            )}
          >
            <Settings className="size-5" aria-hidden />
          </Link>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
