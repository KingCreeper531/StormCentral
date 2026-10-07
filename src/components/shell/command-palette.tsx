"use client";

import { useQuery } from "@tanstack/react-query";
import { Crosshair, Search, Thermometer, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchPlaces, type Place } from "@/lib/api/open-meteo";
import { useGeolocate } from "@/hooks/use-geolocate";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { cn } from "@/lib/utils";
import { MODE_IDS, MODES } from "@/modes/registry";
import { useAppStore } from "@/store/app-store";
import { WeatherIcon } from "../ui/weather-icon";

type Item =
  | { kind: "place"; place: Place }
  | { kind: "action"; id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ⌘K / Ctrl-K: search any place on Earth, switch modes, toggle units. */
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
      { kind: "action", id: "gps", label: "Use my current location", icon: <Crosshair className="size-4" />, run: locate },
      ...MODE_IDS.map<Item>((id) => ({
        kind: "action",
        id: `mode-${id}`,
        label: `${MODES[id].label} mode`,
        hint: MODES[id].hotkey,
        icon: <WeatherIcon name={MODES[id].icon} size={18} animated={false} />,
        run: () => setMode(id),
      })),
      {
        kind: "action",
        id: "units",
        label: units.temp === "F" ? "Switch to metric units" : "Switch to imperial units",
        icon: <Thermometer className="size-4" />,
        run: () => setUnits(units.temp === "F" ? "metric" : "imperial"),
      },
      { kind: "action", id: "community", label: "Open the Spotter Network", icon: <Users className="size-4" />, run: () => router.push("/community") },
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search places and commands"
            className="glass-strong w-full max-w-xl overflow-hidden rounded-3xl"
            initial={{ y: -12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 500, damping: 36 }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Search className="size-4 text-ink-3" aria-hidden />
              <input
                ref={inputRef}
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                  else if (e.key === "ArrowDown") {
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
                placeholder="Search a city, ZIP or landmark…"
                className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={items[cursor] ? `pal-${cursor}` : undefined}
              />
              <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-ink-3">esc</kbd>
            </div>
            <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
              {places.isFetching && <li className="px-3 py-2 text-xs text-ink-3">Searching…</li>}
              {items.map((item, i) => (
                <li
                  key={item.kind === "place" ? `p-${item.place.id}` : item.id}
                  id={`pal-${i}`}
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(item)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm", i === cursor ? "bg-white/10 text-ink" : "text-ink-2")}
                >
                  {item.kind === "place" ? (
                    <>
                      <span className="grid size-7 place-items-center rounded-lg bg-white/5 text-[10px] font-semibold text-ink-3">{item.place.countryCode}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-ink">{item.place.name}</span>
                        <span className="text-ink-3"> · {[item.place.region, item.place.country].filter(Boolean).join(", ")}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="grid size-7 place-items-center rounded-lg bg-white/5 text-ink-2">{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {item.hint && <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-ink-3">{item.hint}</kbd>}
                    </>
                  )}
                </li>
              ))}
              {q.length >= 2 && !places.isFetching && places.data?.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">No places match “{q}”.</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
