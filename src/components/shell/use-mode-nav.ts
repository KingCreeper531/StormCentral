"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { prefetchMode } from "@/hooks/queries";
import type { ModeId } from "@/modes/registry";
import { useAppStore } from "@/store/app-store";

/**
 * Mode navigation shared by the desktop tabs and the phone tab bar.
 * From sub-pages (community, profiles, auth) a mode pick also navigates home.
 */
export function useModeNav() {
  const storeMode = useAppStore((s) => s.mode);
  const setStoreMode = useAppStore((s) => s.setMode);
  const qc = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const onHome = pathname === "/";

  const select = (m: ModeId) => {
    setStoreMode(m);
    if (!onHome) router.push("/");
  };
  /** Prefetch a mode's feeds so the switch lands on data, not skeletons. */
  const warm = (m: ModeId) => prefetchMode(qc, m, useAppStore.getState().location);

  /** The mode marked as current — none on sub-pages. */
  const active: ModeId | null = onHome ? storeMode : null;
  return { active, select, warm };
}
