"use client";

import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/use-t";
import { PANEL_KEY } from "@/lib/pro/link";
import { useAppStore } from "@/store/app-store";

// MapLibre and the decoders need the browser: loaded on the client only, like the workspace itself.
const noSubscribe = () => () => {};

const Workspace = dynamic(() => import("./professional-workspace").then((m) => m.ProfessionalWorkspace), { ssr: false });

/**
 * A Professional-mode panel in a window of its own (`/pro-window?view=p2&ws=…`,
 * or `view=panel` for the analysis tools), for a second or third monitor. It
 * stays in step with the workspace that opened it (`ws`, lib/pro/link.ts).
 */
export function ProWindow() {
  const t = useT();
  const hydrated = useAppStore((s) => s.hydrated);
  // The address doesn't change in this window; null while rendering on the server.
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => null);
  const params = search == null ? null : new URLSearchParams(search);
  const asked = params?.get("view");
  const ws = params?.get("ws") ?? "";
  const view = params == null ? null : ws && (asked === PANEL_KEY || /^p[1-9]$/.test(asked ?? "")) ? asked! : "";
  useEffect(() => {
    if (view) document.title = view === PANEL_KEY ? `${t("Analysis panel")} · Storm Central` : `${t("Panel {n}", { n: view.slice(1) })} · Storm Central`;
  }, [view, t]);

  if (view === null || !hydrated) return null;
  if (!view) return <p className="p-6 text-sm text-ink-3">{t("Open panels from Professional mode.")}</p>;
  return (
    <main className="fixed inset-0 bg-canvas">
      <Workspace popout={view} workspace={ws} />
    </main>
  );
}
