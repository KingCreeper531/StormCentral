"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSettingsSync } from "@/hooks/use-settings-sync";
import { proView } from "@/lib/broadcast/pro-view";
import { useT } from "@/lib/i18n/use-t";
import { useAppStore } from "@/store/app-store";
import { useBroadcastStore } from "@/store/broadcast-store";

const SevereMode = dynamic(() => import("../modes/severe-mode").then((m) => m.SevereMode), { ssr: false });
const BroadcastProStage = dynamic(() => import("./broadcast-pro-stage").then((m) => m.BroadcastProStage), { ssr: false });

/**
 * Broadcast mode on a page of its own (/broadcast): the radar map full screen
 * with on-air graphics, for streaming or recording, or Professional mode's
 * panels under the same graphics (the Pro view, while Professional mode is
 * on). It's kept off the app's radar, so nobody opening the radar lands in
 * it; Settings links here, and leaving opens the radar.
 */
export function BroadcastPage() {
  useSettingsSync();
  const t = useT();
  const router = useRouter();
  const hydrated = useAppStore((s) => s.hydrated);
  const professional = useAppStore((s) => s.professional);
  const saved = useBroadcastStore((s) => s.proView);
  const pro = proView(professional, saved).on;
  const onExit = () => router.push("/?mode=severe");

  // No app chrome while on air; the Pro view's panels keep their map credits where they are (globals.css).
  useEffect(() => {
    document.documentElement.dataset.broadcast = pro ? "pro" : "on";
  }, [pro]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.broadcast;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    },
    [],
  );

  return (
    <main className="fixed inset-0 bg-canvas">
      {!hydrated ? (
        <div className="grid h-full place-items-center">
          <p className="label">{t("Loading map")}</p>
        </div>
      ) : pro ? (
        <BroadcastProStage onExit={onExit} />
      ) : (
        <SevereMode studio={{ onExit }} />
      )}
    </main>
  );
}
