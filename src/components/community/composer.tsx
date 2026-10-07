"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Forecast } from "@/lib/api/open-meteo";
import { CATEGORIES, CATEGORY_IDS, SEVERITY_LABELS, type Category } from "@/lib/community";
import { preparePhoto } from "@/lib/image-client";
import { currentHourIndex } from "@/lib/weather/view";
import { cn } from "@/lib/utils";
import { qk, useSession } from "@/hooks/queries";
import { useAppStore } from "@/store/app-store";
import { Segmented } from "../ui/segmented";
import { WeatherIcon } from "../ui/weather-icon";

export function Composer() {
  const open = useAppStore((s) => s.composerOpen);
  const setOpen = useAppStore((s) => s.setComposerOpen);
  const loc = useAppStore((s) => s.location);
  const { data: user, isLoading } = useSession();
  const qc = useQueryClient();

  const [category, setCategory] = useState<Category>("observation");
  const [severity, setSeverity] = useState(0);
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; width: number; height: number } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [precise, setPrecise] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

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
          JSON.stringify({ tempC: f.current.temp, code: f.current.code, windMs: f.current.windSpeed, gustMs: f.hourly.gust10[i] ?? f.current.windGust }),
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="composer-title"
            className="glass-strong max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 id="composer-title" className="text-lg font-semibold">
                  Report the weather
                </h2>
                <p className="text-xs text-ink-3">Ground truth helps everyone nearby — and verifies the radar.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-full hover:bg-white/10" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            {isLoading ? null : !user ? (
              <div className="rounded-2xl bg-white/[0.04] p-5 text-center">
                <p className="text-sm text-ink-2">Sign in to post reports, verify others&apos; observations and build your spotter reputation.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Link href="/login?next=/" onClick={() => setOpen(false)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">
                    Sign in
                  </Link>
                  <Link href="/register?next=/" onClick={() => setOpen(false)} className="rounded-full px-4 py-2 text-sm font-semibold text-ink ring-1 ring-white/20">
                    Create account
                  </Link>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit.mutate();
                }}
                className="space-y-4"
              >
                <fieldset>
                  <legend className="mb-2 text-xs font-medium text-ink-3">What are you seeing?</legend>
                  <div className="grid grid-cols-5 gap-1.5">
                    {CATEGORY_IDS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setCategory(id)}
                        aria-pressed={category === id}
                        className={cn(
                          "flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-medium ring-1 transition",
                          category === id ? "bg-white/12 text-ink ring-accent" : "text-ink-3 ring-white/8 hover:bg-white/5",
                        )}
                      >
                        <WeatherIcon name={CATEGORIES[id].icon} size={30} animated={false} />
                        <span className="leading-tight">{CATEGORIES[id].label}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <p className="mb-2 text-xs font-medium text-ink-3">Severity</p>
                  <Segmented ariaLabel="Severity" value={severity} onChange={setSeverity} options={SEVERITY_LABELS.map((l, i) => ({ value: i, label: l }))} />
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-ink-3">Details</span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    required
                    placeholder="e.g. Quarter-size hail for 5 minutes, ground turning white. Wind gusting hard from the west."
                    className="w-full resize-none rounded-2xl bg-white/[0.05] px-4 py-3 text-sm outline-none ring-1 ring-white/10 placeholder:text-ink-3 focus:ring-accent"
                  />
                  <span className="mt-1 block text-right text-[10px] text-ink-3 tabular">{body.length}/1000</span>
                </label>

                <div className="flex items-center gap-3">
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                  {photo ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt="Selected photo preview" className="h-20 w-28 rounded-xl object-cover" />
                      <button type="button" onClick={() => setPhoto(null)} className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-black ring-1 ring-white/20" aria-label="Remove photo">
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-2 ring-1 ring-white/10 hover:bg-white/5">
                      {photoBusy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} Add photo
                    </button>
                  )}
                  <p className="text-[11px] leading-snug text-ink-3">Photos are resized and stripped of EXIF/GPS metadata before upload.</p>
                </div>

                <label className="flex items-start gap-2 text-xs text-ink-2">
                  <input type="checkbox" checked={precise} onChange={(e) => setPrecise(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  <span>
                    Share precise GPS position (~100 m). Otherwise reports are placed at <span className="text-ink">{loc.name}</span>, rounded to ~1 km for privacy.
                  </span>
                </label>

                {submit.error && <p className="rounded-xl bg-nogo/10 px-3 py-2 text-xs text-ink ring-1 ring-nogo/30">{(submit.error as Error).message}</p>}

                <button type="submit" disabled={submit.isPending || body.trim().length < 3} className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-semibold text-black transition disabled:opacity-40">
                  {submit.isPending && <Loader2 className="size-4 animate-spin" />} Post report
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
