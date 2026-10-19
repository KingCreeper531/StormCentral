"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_SHARE_HOURS, SHARE_HOURS, type ShareHours } from "@/lib/chasers";

/** What the sharing beacon (components/community/chaser-beacon) is doing, for Settings to show. */
export type BeaconStatus = "off" | "locating" | "live" | "denied" | "error";

/**
 * Sharing my live position as a storm chaser. Off by default and local to
 * this device; while on, the beacon sends the position until `until`.
 */
export interface ChaserState {
  hydrated: boolean;
  sharing: boolean;
  hours: ShareHours;
  /** When sharing turns itself off (epoch ms), or null while off. */
  until: number | null;
  status: BeaconStatus;
  /** When the server last took my position. */
  lastSentAt: number | null;
  setSharing: (on: boolean, now?: number) => void;
  setHours: (h: ShareHours, now?: number) => void;
  setStatus: (status: BeaconStatus, lastSentAt?: number) => void;
}

type Persisted = Pick<ChaserState, "sharing" | "hours" | "until">;

/** Restored settings, made safe: a window that ended while the app was closed reads as off. */
export function normalizeChaser(p: Partial<Persisted> | null | undefined, now: number): Persisted {
  const hours = (SHARE_HOURS as readonly number[]).includes(p?.hours as number) ? (p!.hours as ShareHours) : DEFAULT_SHARE_HOURS;
  const until = typeof p?.until === "number" && Number.isFinite(p.until) ? p.until : null;
  const sharing = p?.sharing === true && until != null && until > now;
  return { sharing, hours, until: sharing ? until : null };
}

export const useChaserStore = create<ChaserState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      sharing: false,
      hours: DEFAULT_SHARE_HOURS,
      until: null,
      status: "off",
      lastSentAt: null,
      setSharing: (on, now = Date.now()) =>
        set(on ? { sharing: true, until: now + get().hours * 3_600_000 } : { sharing: false, until: null, status: "off", lastSentAt: null }),
      // Picking another window while sharing restarts it from now.
      setHours: (hours, now = Date.now()) => set((s) => (s.sharing ? { hours, until: now + hours * 3_600_000 } : { hours })),
      setStatus: (status, lastSentAt) => set((s) => ({ status, lastSentAt: lastSentAt ?? s.lastSentAt })),
    }),
    {
      name: "stormcentral:chaser:v1",
      version: 1,
      // Rehydrated from a client effect (Providers) so SSR markup and first render match.
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): Persisted => ({ sharing: s.sharing, hours: s.hours, until: s.until }),
      merge: (persisted, current) => ({ ...current, ...normalizeChaser(persisted as Partial<Persisted>, Date.now()) }),
      onRehydrateStorage: () => () => useChaserStore.setState({ hydrated: true }),
    },
  ),
);
