"use client";

import { ArrowDown, ArrowUp, ImageUp, MapPinPlus, Radio, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { DEFAULT_ACCENT, logoFromFile, MAX_SCENES, TOUR_SECONDS, useBroadcastStore, type BroadcastParts } from "@/store/broadcast-store";
import { Button, IconButton } from "../ui/button";
import { Toggle } from "../ui/misc";
import { Segmented } from "../ui/segmented";
import { StationLogo } from "./broadcast-overlay";

const noSubscribe = () => () => {};
const FIELD =
  "h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong";
const LABEL = "mb-1.5 block text-[12px] font-medium text-ink-2";

const PARTS: { key: keyof BroadcastParts; label: string }[] = [
  { key: "bug", label: "Station name and logo" },
  { key: "clock", label: "Clock" },
  { key: "counts", label: "Active warnings count" },
  { key: "lower", label: "Lower third (the warning you pick, or the scene)" },
  { key: "ticker", label: "Warnings ticker" },
];

export interface BroadcastDialogProps {
  open: boolean;
  onClose: () => void;
  /** Starts broadcast mode; absent while it's already on. */
  onStart?: () => void;
  /** The map's view now, to save as a scene, with a suggested name. */
  currentView: () => { lat: number; lon: number; zoom: number; name: string } | null;
}

/**
 * Broadcast settings: the station's branding, which graphics show, and the
 * scenes a tour steps through. Phones: full height; md+: a centred panel.
 */
export function BroadcastDialog(props: BroadcastDialogProps) {
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!client) return null;
  return createPortal(
    <AnimatePresence>
      {props.open && (
        <motion.div
          key="broadcast"
          className="fixed inset-0 z-[70] flex flex-col bg-black/60 md:items-center md:justify-center md:p-4 lg:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
        >
          <Panel {...props} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Panel({ onClose, onStart, currentView }: BroadcastDialogProps) {
  const t = useT();
  const s = useBroadcastStore();
  const ref = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sceneName, setSceneName] = useState("");

  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc closes it wherever the focus is.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      s.set({ logo: await logoFromFile(f) });
    } catch (err) {
      setError(err instanceof Error && err.message === "not-an-image" ? t("Pick a PNG, JPEG, WebP or GIF image.") : t("That image couldn't be used. Try a smaller one."));
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const saveScene = () => {
    const v = currentView();
    if (!v) return;
    s.addScene({ lat: v.lat, lon: v.lon, zoom: v.zoom, name: sceneName.trim() || v.name });
    setSceneName("");
  };

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="broadcast-title"
      tabIndex={-1}
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-1 pt-[env(safe-area-inset-top)] outline-none md:max-h-[min(820px,100%)] md:max-w-[520px] md:flex-none md:rounded-[var(--radius-panel)] md:border md:border-line md:pt-0"
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 12, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line py-3 pr-3 pl-5">
        <div className="min-w-0">
          <h2 id="broadcast-title" className="truncate text-[15px] font-semibold text-ink">
            {t("Broadcast mode")}
          </h2>
          <p className="truncate text-xs text-ink-3">{t("The radar full screen with on-air graphics, for streaming or recording.")}</p>
        </div>
        <IconButton label={t("Close")} onClick={onClose}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </header>

      <div className="min-h-0 flex-auto space-y-6 overflow-y-auto overscroll-contain px-5 pt-5 pb-6">
        <section className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink">{t("Your station")}</h3>
          <div className="flex items-start gap-3">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-line bg-[#0b0f1a]">
              <StationLogo className="size-14 object-contain" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => file.current?.click()}>
                  <ImageUp className="size-3.5" aria-hidden />
                  {t("Upload a logo")}
                </Button>
                {s.logo && (
                  <Button size="sm" variant="ghost" onClick={() => s.set({ logo: null })}>
                    {t("Use the app icon")}
                  </Button>
                )}
              </div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
              <p className="text-[11px] text-ink-3">{t("Square works best. It's kept on this device, shrunk to 256 px.")}</p>
              {error && (
                <p role="alert" className="text-[12px] text-caution">
                  {error}
                </p>
              )}
            </div>
          </div>
          <label className="block">
            <span className={LABEL}>{t("Name")}</span>
            <input className={FIELD} value={s.name} maxLength={40} onChange={(e) => s.set({ name: e.target.value })} placeholder="Storm Central" />
          </label>
          <label className="block">
            <span className={LABEL}>{t("Tag line")}</span>
            <input className={FIELD} value={s.tagline} maxLength={60} onChange={(e) => s.set({ tagline: e.target.value })} placeholder={t("Radar · Warnings")} />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="color" value={s.accent} onChange={(e) => s.set({ accent: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" aria-label={t("Accent colour")} />
              {t("Accent colour")}
            </label>
            {s.accent.toLowerCase() !== DEFAULT_ACCENT && (
              <Button size="sm" variant="ghost" onClick={() => s.set({ accent: DEFAULT_ACCENT })}>
                {t("Reset")}
              </Button>
            )}
          </div>
          <Toggle label={t("LIVE badge (turn off for recorded clips)")} checked={s.live} onChange={(live) => s.set({ live })} />
        </section>

        <section className="space-y-1">
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("Graphics")}</h3>
          {PARTS.map((p) => (
            <Toggle key={p.key} label={t(p.label)} checked={s.parts[p.key]} onChange={(on) => s.setPart(p.key, on)} />
          ))}
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-[13px] font-semibold text-ink">{t("Scenes")}</h3>
            <p className="text-[12px] text-ink-3">{t("Save views to step through on air, or play them as a tour. The lower third shows each scene's name.")}</p>
          </div>
          <div className="flex gap-2">
            <input className={FIELD} value={sceneName} maxLength={40} onChange={(e) => setSceneName(e.target.value)} placeholder={t("Scene name, e.g. Oklahoma City")} aria-label={t("Scene name")} />
            <Button size="sm" className="h-9 shrink-0" onClick={saveScene} disabled={s.scenes.length >= MAX_SCENES}>
              <MapPinPlus className="size-3.5" aria-hidden />
              {t("Save this view")}
            </Button>
          </div>
          {s.scenes.length > 0 ? (
            <ol className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
              {s.scenes.map((sc, i) => (
                <li key={sc.id} className="flex items-center gap-1 py-1 pr-1 pl-3">
                  <span className="w-5 shrink-0 text-[11px] text-ink-3 tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{sc.name}</span>
                  <IconButton size="sm" label={t("Move {name} up", { name: sc.name })} disabled={i === 0} onClick={() => s.moveScene(sc.id, -1)}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </IconButton>
                  <IconButton size="sm" label={t("Move {name} down", { name: sc.name })} disabled={i === s.scenes.length - 1} onClick={() => s.moveScene(sc.id, 1)}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </IconButton>
                  <IconButton size="sm" label={t("Delete {name}", { name: sc.name })} onClick={() => s.removeScene(sc.id)}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[12px] text-ink-3">{t("No scenes yet: move the map to a place and save it.")}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-ink-2">{t("Each scene on a tour")}</span>
            <Segmented<number>
              ariaLabel={t("Seconds on each scene")}
              size="sm"
              value={s.tourSeconds}
              onChange={(tourSeconds) => s.set({ tourSeconds })}
              options={TOUR_SECONDS.map((n) => ({ value: n, label: t("{n} s", { n }) }))}
            />
          </div>
        </section>
      </div>

      <footer className={cn("flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)_+_12px)] md:pb-3", "max-md:[&>*]:flex-1")}>
        <Button onClick={onClose}>{onStart ? t("Close") : t("Done")}</Button>
        {onStart && (
          <Button variant="primary" onClick={onStart}>
            <Radio className="size-4" aria-hidden />
            {t("Start broadcast mode")}
          </Button>
        )}
      </footer>
    </motion.div>
  );
}
