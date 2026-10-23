"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { PluginsManager } from "../settings/addons-panel";
import { IconButton } from "../ui/button";
import { Segmented } from "../ui/segmented";

type Tab = "layers" | "plugins";

/**
 * Broadcast mode's layers and plugins menu: a panel down the right side
 * that leaves the map in view, so each change shows on the map as it's made.
 * Layers is the radar map's own controls (product, overlays, GIS layers,
 * map style); Plugins switches installed plugins on and off, sets their
 * opacity, and adds or removes them. Exported loops never include it (they
 * draw from the map, not the page); a screen capture does while it's open.
 */
export function BroadcastLayers({ open, onClose, layers }: { open: boolean; onClose: () => void; layers: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="broadcast-layers"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[380px] flex-col border-l border-line bg-surface-1 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl"
        >
          <Body onClose={onClose} layers={layers} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Body({ onClose, layers }: { onClose: () => void; layers: React.ReactNode }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("layers");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={ref} role="dialog" aria-labelledby="broadcast-layers-title" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line py-3 pr-3 pl-5">
        <h2 id="broadcast-layers-title" className="truncate text-[15px] font-semibold text-ink">
          {t("Layers and plugins")}
        </h2>
        <IconButton label={t("Close")} onClick={onClose}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </header>
      <div className="shrink-0 px-4 pt-3">
        <Segmented
          stretch
          ariaLabel={t("Layers and plugins")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "layers", label: t("Layers") },
            { value: "plugins", label: t("Plugins") },
          ]}
        />
      </div>
      <div key={tab} className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-4 pt-4 pb-6">{tab === "layers" ? layers : <PluginsManager />}</div>
    </div>
  );
}
