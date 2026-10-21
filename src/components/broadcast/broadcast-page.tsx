"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useSettingsSync } from "@/hooks/use-settings-sync";
import { useT } from "@/lib/i18n/use-t";
import { useAppStore } from "@/store/app-store";

const SevereMode = dynamic(() => import("../modes/severe-mode").then((m) => m.SevereMode), { ssr: false });

/**
 * Broadcast mode on a page of its own (/broadcast): the radar map full screen
 * with on-air graphics, for streaming or recording. It's kept off the app's
 * radar, so nobody opening the radar lands in it; Settings links here, and
 * leaving opens the radar.
 */
export function BroadcastPage() {
  useSettingsSync();
  const t = useT();
  const router = useRouter();
  const hydrated = useAppStore((s) => s.hydrated);
  return (
    <main className="fixed inset-0 bg-canvas">
      {hydrated ? (
        <SevereMode studio={{ onExit: () => router.push("/?mode=severe") }} />
      ) : (
        <div className="grid h-full place-items-center">
          <p className="label">{t("Loading map")}</p>
        </div>
      )}
    </main>
  );
}
