"use client";

import { useQuery } from "@tanstack/react-query";
import { Crosshair, Search, Thermometer, Users, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { searchPlaces, type Place } from "@/lib/api/open-meteo";
import { useGeolocate } from "@/hooks/use-geolocate";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { COMMUNITY_ENABLED } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { MODE_IDS, MODES } from "@/modes/registry";
import { useAppStore } from "@/store/app-store";

type Item =
  | { kind: "place"; place: Place }
  | { kind: "action"; id: string; label: string; hint?: string; Icon: LucideIcon; run: () => void };

const KBD = "rounded-[4px] border border-line px-1.5 font-mono text-[11px] leading-4 text-ink-3";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * ⌘K / Ctrl-K (or "/"): search any place on Earth, switch modes, toggle units.
 * Phones get a full-screen sheet; md+ a centred panel.
 */
export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const setLocation = useAppStore((s) => s.setLocation);
  const setMode = useAppStore((s) => s.setMode);
  const units = useAppStore((s) => s.units);
  const setUnits = useAppStore((s) => s.setUnits);
  const router = useRouter();
  const { locate } = useGeolocate();
  const [term, setTerm] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(term.trim(), 220);

  useHotkeys({
    "mod+k": (e) => {
      e.preventDefault();
      setOpen(!useAppStore.getState().paletteOpen);
    },
    "/": (e) => {
      e.preventDefault();
      setOpen(true);
    },
  });

  const places = useQuery({
    queryKey: ["geocode", q.toLowerCase()],
    queryFn: ({ signal }) => searchPlaces(q, signal),
    enabled: open && q.length >= 2,
    staleTime: 24 * 3_600_000,
  });

  const close = () => {
    setOpen(false);
    setTerm("");
    setCursor(0);
  };

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { kind: "action", id: "gps", label: "Use my current location", Icon: Crosshair, run: locate },
      ...MODE_IDS.map<Item>((id) => ({
        kind: "action",
        id: `mode-${id}`,
        label: `${MODES[id].label} mode`,
        hint: MODES[id].hotkey,
        Icon: MODES[id].Icon,
        run: () => setMode(id),
      })),
      {
        kind: "action",
        id: "units",
        label: units.temp === "F" ? "Switch to metric units" : "Switch to imperial units",
        Icon: Thermometer,
        run: () => setUnits(units.temp === "F" ? "metric" : "imperial"),
      },
      ...(COMMUNITY_ENABLED
        ? [{ kind: "action", id: "community", label: "Open spotter network", Icon: Users, run: () => router.push("/community") } satisfies Item]
        : []),
    ];
    const t = term.trim().toLowerCase();
    const filtered = t ? actions.filter((a) => a.kind === "action" && a.label.toLowerCase().includes(t)) : actions;
    return [...(places.data ?? []).map<Item>((place) => ({ kind: "place", place })), ...filtered];
  }, [places.data, term, locate, setMode, setUnits, units.temp, router]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "place") {
      const p = item.place;
      setLocation({ lat: p.lat, lon: p.lon, name: [p.name, p.countryCode === "US" ? p.region : p.country].filter(Boolean).join(", "), source: "search" });
    } else item.run();
    close();
  };

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const status = places.isFetching
    ? "Searching…"
    : q.length >= 2 && places.data?.length === 0
      ? `No places match “${q}”.`
      : "";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[60] flex flex-col md:items-center md:bg-black/60 md:px-4 md:pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search places and commands"
            onKeyDown={(e) => e.key === "Escape" && close()}
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-canvas pt-[env(safe-area-inset-top)] md:max-w-[560px] md:flex-none md:rounded-[var(--radius-panel)] md:border md:border-line md:bg-surface-1 md:pt-0"
          >
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line pr-2 pl-4 md:h-12 md:pr-3">
              <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
              <input
                ref={inputRef}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(items.length - 1, c + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    choose(items[cursor]);
                  }
                }}
                placeholder="Search a city, ZIP or landmark"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                // 16 px on phones so iOS doesn't zoom the page on focus.
                className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 md:text-[15px]"
                // The whole header row reads as the field; a focus outline around the bare input would be noise.
                style={{ outline: "none" }}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-autocomplete="list"
                aria-activedescendant={items[cursor] ? `pal-${cursor}` : undefined}
              />
              <kbd className={cn(KBD, "hidden md:inline")}>Esc</kbd>
              <button
                type="button"
                onClick={close}
                className="h-11 shrink-0 rounded-[var(--radius-control)] px-2 text-sm font-medium text-accent md:hidden"
              >
                Cancel
              </button>
            </div>

            {/* Always mounted (zero height when empty) so screen readers announce changes. */}
            <p role="status" aria-live="polite" className={cn("px-4 text-xs text-ink-3", status && "pt-2.5 pb-1")}>
              {status}
            </p>

            <ul
              id="palette-list"
              role="listbox"
              aria-label="Results"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 pb-[calc(env(safe-area-inset-bottom)_+_8px)] md:max-h-[min(440px,60vh)] md:flex-none md:pb-1.5"
            >
              {items.map((item, i) => {
                const heading = i === 0 || items[i - 1]!.kind !== item.kind ? (item.kind === "place" ? "Places" : "Commands") : null;
                const selected = i === cursor;
                return (
                  <Fragment key={item.kind === "place" ? `p-${item.place.id}` : item.id}>
                    {heading && (
                      <li role="presentation" aria-hidden className="label px-2.5 pt-2 pb-1">
                        {heading}
                      </li>
                    )}
                    <li
                      id={`pal-${i}`}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => choose(item)}
                      className={cn(
                        "flex min-h-10 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-2.5 text-sm pointer-coarse:min-h-12",
                        selected ? "bg-surface-2 text-ink" : "text-ink-2",
                      )}
                    >
                      {item.kind === "place" ? (
                        <>
                          <span className="grid h-5 min-w-7 shrink-0 place-items-center rounded-[4px] border border-line px-1 font-mono text-[11px] text-ink-3">
                            {item.place.countryCode}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-medium text-ink">{item.place.name}</span>
                            <span className="ml-2 text-ink-3">{[item.place.region, item.place.country].filter(Boolean).join(", ")}</span>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="grid w-7 shrink-0 place-items-center text-ink-3">
                            <item.Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.hint && <kbd className={cn(KBD, "hidden md:inline")}>{item.hint}</kbd>}
                        </>
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
