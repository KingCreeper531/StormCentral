"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Forecast } from "@/lib/api/open-meteo";
import { CATEGORIES, CATEGORY_IDS, SEVERITY_LABELS, type Category } from "@/lib/community";
import { preparePhoto } from "@/lib/image-client";
import { currentHourIndex } from "@/lib/weather/view";
import { cn } from "@/lib/utils";
import { qk, useSession } from "@/hooks/queries";
import { useAppStore } from "@/store/app-store";
import { Button, buttonClass, IconButton } from "../ui/button";
import { Skeleton } from "../ui/misc";
import { Segmented } from "../ui/segmented";
import { WeatherIcon } from "../ui/weather-icon";

const FIELD_LABEL = "mb-2 block text-[13px] font-medium text-ink-2";

/**
 * Report composer. Phones: a full-height sheet with Cancel / title / Post in
 * the header (safe-area padded); signed out, a content-height bottom sheet
 * with the sign-in prompt. md+: a centred 520 px panel with the actions in a
 * footer.
 */
export function Composer() {
  const open = useAppStore((s) => s.composerOpen);
  const setOpen = useAppStore((s) => s.setComposerOpen);
  const imperial = useAppStore((s) => s.units.distance === "mi");
  const loc = useAppStore((s) => s.location);
  const { data: user, isLoading } = useSession();
  const qc = useQueryClient();
  const pathname = usePathname();
  // Signing in from the prompt returns to the page the composer was opened on.
  const next = `?next=${encodeURIComponent(pathname)}`;
  const signedOut = !isLoading && !user;

  const [category, setCategory] = useState<Category>("observation");
  const [severity, setSeverity] = useState(0);
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; width: number; height: number } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [precise, setPrecise] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  // Move focus into the dialog so Escape and screen readers start there.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const reset = () => {
    setCategory("observation");
    setSeverity(0);
    setBody("");
    setPhoto(null);
    setPrecise(false);
  };

  const submit = useMutation({
    mutationFn: async () => {
      let { lat, lon } = loc;
      if (precise && "geolocation" in navigator) {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10_000 }));
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
      }
      const fd = new FormData();
      fd.set("body", body);
      fd.set("category", category);
      fd.set("severity", String(severity));
      fd.set("lat", String(lat));
      fd.set("lon", String(lon));
      fd.set("place", loc.name.slice(0, 80));
      fd.set("precise", String(precise));
      // Ground truth vs. model: snapshot what the forecast said right now.
      const f = qc.getQueryData<Forecast>(qk.forecast(loc));
      if (f) {
        const i = currentHourIndex(f, Date.now());
        fd.set(
          "conditions",
          JSON.stringify({
            tempC: f.current.temp,
            code: f.current.code,
            windMs: f.current.windSpeed,
            gustMs: f.hourly.gust10[i] ?? f.current.windGust,
            precipMm: f.hourly.precip[i] ?? null,
            precipProb: f.hourly.precipProb[i] ?? null,
          }),
        );
      }
      if (photo) fd.set("image", new File([photo.blob], photo.blob.type === "image/webp" ? "photo.webp" : "photo.jpg", { type: photo.blob.type }));
      const res = await fetch("/api/posts", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Couldn't post your report");
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["posts"] });
      reset();
      setOpen(false);
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const p = await preparePhoto(file);
      setPhoto({ ...p, url: URL.createObjectURL(p.blob) });
    } catch {
      alert("That image couldn't be read. Try a JPEG, PNG or WebP photo.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const close = () => setOpen(false);
  const canPost = !submit.isPending && body.trim().length >= 3;
  const spinner = submit.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />;

  const header = (
    <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-line px-3 md:flex md:h-auto md:justify-between md:py-3 md:pr-3 md:pl-5">
      <div className="md:hidden">
        <Button variant="ghost" onClick={close} className="text-accent hover:text-accent">
          Cancel
        </Button>
      </div>
      <div className="min-w-0 text-center md:text-left">
        <h2 id="composer-title" className="truncate text-[15px] font-semibold text-ink">
          Report weather
        </h2>
        <p className="hidden truncate text-xs text-ink-3 md:block">Shown in the spotter feed and on the radar map.</p>
      </div>
      <div className="flex justify-end">
        {user && (
          <Button type="submit" variant="ghost" disabled={!canPost} aria-label="Post report" className="font-semibold text-accent hover:text-accent md:hidden">
            {spinner}
            Post
          </Button>
        )}
        <IconButton label="Close" onClick={close} className="hidden md:inline-flex">
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
    </header>
  );

  const scrollBody = "min-h-0 flex-auto overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)_+_20px)] md:px-5 md:pt-5 md:pb-5";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="composer"
          className="fixed inset-0 z-[70] flex flex-col bg-black/60 md:items-center md:justify-center md:p-4 lg:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="composer-title"
            tabIndex={-1}
            className={cn(
              "flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-1 pt-[env(safe-area-inset-top)] outline-none md:max-h-[min(780px,100%)] md:max-w-[520px] md:flex-none md:rounded-[var(--radius-panel)] md:border md:border-line md:pt-0",
              // Signed out there is only a sentence and two buttons: a bottom sheet sized to its content, not an empty full screen.
              signedOut && "max-md:mt-auto max-md:flex-none max-md:rounded-t-[var(--radius-sheet)] max-md:border-t max-md:border-line max-md:pt-0",
            )}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onKeyDown={(e) => e.key === "Escape" && close()}
          >
            {isLoading ? (
              <>
                {header}
                <div className={scrollBody}>
                  <Skeleton className="h-40" />
                </div>
              </>
            ) : !user ? (
              <>
                {header}
                <div className={scrollBody}>
                  <p className="text-sm text-ink-2">Sign in to post reports and confirm other spotters&apos; observations.</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 md:flex md:flex-wrap">
                    <Link href={`/login${next}`} onClick={close} className={buttonClass("primary")}>
                      Sign in
                    </Link>
                    <Link href={`/register${next}`} onClick={close} className={buttonClass("secondary")}>
                      Create account
                    </Link>
                  </div>
                </div>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit.mutate();
                }}
                className="flex min-h-0 flex-auto flex-col"
              >
                {header}
                <div className={cn(scrollBody, "space-y-5")}>
                  <fieldset className="min-w-0">
                    <legend className={FIELD_LABEL}>Category</legend>
                    <div className="grid grid-cols-2 gap-1.5 md:auto-rows-fr md:grid-cols-5">
                      {CATEGORY_IDS.map((id) => {
                        const active = category === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setCategory(id)}
                            aria-pressed={active}
                            className={cn(
                              "flex min-h-11 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors md:flex-col md:justify-center md:gap-1 md:px-1 md:py-2 md:text-center md:text-[11px] md:leading-tight",
                              active ? "border-accent bg-surface-3 text-ink" : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink",
                            )}
                          >
                            <WeatherIcon name={CATEGORIES[id].icon} size={24} animated={false} />
                            <span className="min-w-0">{CATEGORIES[id].label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div>
                    <p className={FIELD_LABEL}>Severity</p>
                    <Segmented
                      stretch
                      ariaLabel="Severity"
                      value={severity}
                      onChange={setSeverity}
                      options={SEVERITY_LABELS.map((l, i) => ({ value: i, label: l }))}
                    />
                  </div>

                  <div>
                    <label htmlFor="composer-body" className={FIELD_LABEL}>
                      Details
                    </label>
                    <textarea
                      id="composer-body"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      maxLength={1000}
                      rows={4}
                      required
                      aria-describedby="composer-count"
                      placeholder="e.g. Quarter-size hail for 5 minutes, ground turning white. Wind gusting hard from the west."
                      className="block w-full resize-none rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-accent pointer-coarse:text-base"
                    />
                    <p id="composer-count" className="label mt-1 text-right tabular">
                      {body.length}/1000
                    </p>
                  </div>

                  <div>
                    <p className={FIELD_LABEL}>Photo</p>
                    <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                    {photo ? (
                      <div className="flex items-start gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.url} alt="Selected photo preview" className="h-20 w-28 shrink-0 rounded-[var(--radius-control)] border border-line object-cover" />
                        <Button variant="ghost" size="sm" onClick={() => setPhoto(null)} aria-label="Remove photo">
                          <X className="size-4" aria-hidden />
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <Button onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                        {photoBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                        Add photo
                      </Button>
                    )}
                    <p className="label mt-2">Photos are resized and stripped of EXIF and GPS metadata before upload.</p>
                  </div>

                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={precise}
                      onChange={(e) => setPrecise(e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">Share precise GPS position (about {imperial ? "300 ft" : "100 m"})</span>
                      <span className="label mt-0.5 block">
                        Otherwise the report is placed at <span className="text-ink-2">{loc.name}</span>, rounded to about {imperial ? "half a mile" : "1 km"}.
                      </span>
                    </span>
                  </label>

                  {submit.error && (
                    <p role="alert" className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-xs text-ink-2">
                      {(submit.error as Error).message}
                    </p>
                  )}
                </div>

                <footer className="hidden shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3 md:flex">
                  <Button onClick={close}>Cancel</Button>
                  <Button type="submit" variant="primary" disabled={!canPost}>
                    {spinner}
                    Post report
                  </Button>
                </footer>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
