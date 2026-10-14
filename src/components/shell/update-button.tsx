"use client";

import { Download, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { appUpdater, installUpdate } from "@/lib/native/app-updater";
import { Button } from "../ui/button";

type Phase = { kind: "idle" } | { kind: "permission" } | { kind: "downloading"; percent: number } | { kind: "installing" } | { kind: "error"; message: string };

/**
 * Android: "Update" downloads and installs in the app. The first time,
 * Android needs permission to install apps from Storm Central; this walks
 * through it. After installing, Android restarts the app on the new version.
 */
export function UpdateButton({ version, size = "sm", onStatus }: { version: string; size?: "sm" | "md"; onStatus?: (text: string | null) => void }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const report = (p: Phase) => {
    setPhase(p);
    onStatus?.(
      p.kind === "downloading"
        ? p.percent >= 0
          ? t("Downloading {version}: {percent}%", { version, percent: p.percent })
          : t("Downloading {version}…", { version })
        : p.kind === "installing"
          ? t("Installing. If Android asks, tap Update; Storm Central reopens on the new version.")
          : p.kind === "permission"
            ? t("Allow Storm Central to install apps, then come back and tap Update again. This is only needed once.")
            : p.kind === "error"
              ? t(p.message)
              : null,
    );
  };

  const run = async () => {
    try {
      const st = await appUpdater.status();
      if (!st.canInstall) {
        report({ kind: "permission" });
        await appUpdater.openInstallPermission();
        return;
      }
      report({ kind: "downloading", percent: 0 });
      await installUpdate((percent) => report({ kind: "downloading", percent }));
      report({ kind: "installing" });
    } catch (err) {
      report({ kind: "error", message: (err as Error).message || "The update failed. Try again." });
    }
  };

  const busy = phase.kind === "downloading" || phase.kind === "installing";
  return (
    <Button variant="primary" size={size} onClick={() => void run()} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : phase.kind === "permission" ? <ShieldCheck className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
      {phase.kind === "downloading" ? (phase.percent >= 0 ? `${phase.percent}%` : t("Downloading")) : phase.kind === "installing" ? t("Installing") : phase.kind === "permission" ? t("Try again") : t("Update now")}
    </Button>
  );
}
