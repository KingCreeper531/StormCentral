"use client";

import { MapPin, Search } from "lucide-react";
import Link from "next/link";
import { useAppStore } from "@/store/app-store";
import { Segmented } from "../ui/segmented";
import { ModeSwitcher } from "./mode-switcher";
import { UserMenu } from "./user-menu";

export function TopBar() {
  const location = useAppStore((s) => s.location);
  const units = useAppStore((s) => s.units);
  const setUnits = useAppStore((s) => s.setUnits);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
      <div className="pointer-events-auto mx-auto flex max-w-[1600px] items-center gap-2 sm:gap-3">
        <Link href="/" className="glass flex shrink-0 items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5" aria-label="StormCentral home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-7 rounded-full" />
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">
            Storm<span className="text-accent">Central</span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="glass flex min-w-0 flex-1 items-center gap-2 rounded-full px-3.5 py-2 text-left text-sm sm:flex-none md:w-72"
          aria-label={`Location: ${location.name}. Search places`}
        >
          <MapPin className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{location.name}</span>
          <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
          <kbd className="hidden rounded-md bg-white/10 px-1.5 text-[10px] text-ink-3 lg:inline">⌘K</kbd>
        </button>

        <div className="hidden flex-1 justify-center md:flex">
          <ModeSwitcher />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link href="/community" className="glass hidden rounded-full px-3.5 py-1.5 text-xs font-medium text-ink-2 hover:text-ink lg:inline">
            Spotter Network
          </Link>
          <Segmented
            ariaLabel="Temperature units"
            size="sm"
            value={units.temp}
            onChange={(v) => setUnits(v === "F" ? "imperial" : "metric")}
            options={[
              { value: "F", label: "°F" },
              { value: "C", label: "°C" },
            ]}
            className="glass hidden sm:inline-flex"
          />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
