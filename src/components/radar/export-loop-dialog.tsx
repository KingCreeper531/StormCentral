"use client";

import type { Map as MlMap } from "maplibre-gl";
import { Clapperboard, Download, Loader2, Share2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { RadarLoop } from "@/hooks/use-radar-loop";
import { useT } from "@/lib/i18n/use-t";
import { isNativeApp } from "@/lib/platform";
import {
  canShareExport,
  EXPORT_WIDTHS,
  exportFrameDelays,
  MAX_GIF_WIDTH,
  exportRadarLoop,
  formatBytes,
  outputSize,
  progressFraction,
  saveExport,
  shareExport,
  videoMimeType,
  type ExportFormat,
  type ExportLoopOptions,
  type ExportProgress,
  type ExportWidth,
  type LoopExport,
} from "@/lib/radar/export-loop";
import { cn } from "@/lib/utils";
import { clockIn } from "@/lib/weather/view";
import { Button, IconButton } from "../ui/button";
import { Row } from "../ui/misc";
import { Segmented } from "../ui/segmented";

export interface ExportLoopProps {
  /** The MapLibre map the loop is drawn on (null until it has loaded). */
  map: MlMap | null;
  loop: RadarLoop;
  /** Caption title, e.g. "NEXRAD mosaic, reflectivity". */
  title: string;
  /** Caption second line, e.g. the location name. */
  subtitle?: string;
  /** Zone the frame times read in (the selected location's). */
  timeZone?: string;
  /** Loop speed multiplier (1 = normal); the export's frame delay follows it. */
  speed?: number;
  /** Broadcast mode's graphics, drawn over every frame in place of the caption bar. */
  overlay?: ExportLoopOptions["overlay"];
}

type Status =
  | { kind: "idle" }
  | { kind: "busy"; progress: ExportProgress | null }
  | { kind: "done"; result: LoopExport; url: string; shareable: boolean }
  | { kind: "error"; message: string };

const FIELD_LABEL = "mb-2 block text-[13px] font-medium text-ink-2";
const noSubscribe = () => () => {};

/** Opens the export dialog. Disabled until the map exists. */
export function ExportLoopButton({ className, size = "md", ...props }: ExportLoopProps & { className?: string; size?: "sm" | "md" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={t("Export loop")} size={size} onClick={() => setOpen(true)} disabled={!props.map} className={className}>
        <Clapperboard className={size === "sm" ? "size-4" : "size-5"} aria-hidden />
      </IconButton>
      <ExportLoopDialog open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}

/**
 * Export the radar loop as an animated GIF or a video, then save or share it.
 * Phones: a full-height sheet; md+: a centred 520 px panel. Rendered into
 * `document.body`, so a transformed ancestor (the bottom sheet) can't trap it.
 */
export function ExportLoopDialog({ open, onClose, ...props }: ExportLoopProps & { open: boolean; onClose: () => void }) {
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!client) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="export-loop"
          className="fixed inset-0 z-[70] flex flex-col bg-black/60 md:items-center md:justify-center md:p-4 lg:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <ExportPanel onClose={onClose} {...props} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Mounted only while the dialog is open, so every open starts fresh. */
function ExportPanel({ map, loop, title, subtitle, timeZone, speed = 1, overlay, onClose }: ExportLoopProps & { onClose: () => void }) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The export steps the loop and reads it back as it changes; it needs the latest props, not the ones at click time.
  const loopRef = useRef(loop);
  useEffect(() => {
    loopRef.current = loop;
  });

  const [videoType] = useState(() => videoMimeType());
  const [source] = useState(() => {
    const c = map?.getCanvas();
    return c && c.width > 0 && c.height > 0 ? { w: c.width, h: c.height } : null;
  });
  // Broadcast clips default to HD video; everything else to a small GIF.
  const [format, setFormat] = useState<ExportFormat>(overlay && videoType ? "video" : "gif");
  const [width, setWidth] = useState<ExportWidth>(overlay && videoType ? 1280 : EXPORT_WIDTHS[0]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const native = isNativeApp();

  // Move focus into the dialog so Escape and screen readers start there.
  useEffect(() => {
    const id = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Stop a running export when the dialog goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Esc closes it even when the focus has left the dialog (its button can vanish mid-export).
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Release the preview's object URL when it is replaced or the dialog closes.
  const doneUrl = status.kind === "done" ? status.url : null;
  useEffect(() => (doneUrl ? () => URL.revokeObjectURL(doneUrl) : undefined), [doneUrl]);

  const frames = loop.frames;
  const n = frames.length;
  const pending = n - loop.buffered;
  const busy = status.kind === "busy";
  const canExport = !!map && n > 0 && !busy;
  const size = source ? outputSize(source.w, source.h, width) : null;
  const delays = exportFrameDelays(Math.max(2, n), speed);
  const seconds = (ms: number) => `${(ms / 1000).toLocaleString(t.locale, { maximumFractionDigits: 2 })} s`;
  const range =
    n > 0 ? t("{from} to {to}", { from: clockIn(timeZone, frames[0]!.time, t.locale), to: clockIn(timeZone, frames[n - 1]!.time, t.locale) }) : null;

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };
  useEffect(() => {
    closeRef.current = close;
  });

  const run = async () => {
    if (!map || !canExport) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: "busy", progress: null });
    try {
      const result = await exportRadarLoop({
        map,
        getLoop: () => loopRef.current,
        format,
        width,
        title,
        subtitle,
        timeZone,
        locale: t.locale,
        speed,
        signal: ctrl.signal,
        onProgress: (progress) => setStatus({ kind: "busy", progress }),
        overlay,
      });
      if (ctrl.signal.aborted) return;
      setStatus({ kind: "done", result, url: URL.createObjectURL(result.blob), shareable: canShareExport(result) });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus({ kind: "error", message: err instanceof Error ? t(err.message) : t("The export failed.") });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setStatus({ kind: "idle" });
  };

  const fail = (err: unknown) => setStatus({ kind: "error", message: err instanceof Error ? t(err.message) : t("Couldn't save the file.") });

  const header = (
    <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-line px-3 md:flex md:h-auto md:justify-between md:py-3 md:pr-3 md:pl-5">
      <div className="md:hidden">
        <Button variant="ghost" onClick={close} className="text-accent hover:text-accent">
          {status.kind === "done" ? t("Done") : t("Cancel")}
        </Button>
      </div>
      <div className="min-w-0 text-center md:text-left">
        <h2 id="export-loop-title" className="truncate text-[15px] font-semibold text-ink">
          {t("Export radar loop")}
        </h2>
        <p className="hidden truncate text-xs text-ink-3 md:block">{t("Save the loop as an animated GIF or a video.")}</p>
      </div>
      <div className="flex justify-end">
        <IconButton label={t("Close")} onClick={close} className="hidden md:inline-flex">
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
    </header>
  );

  let body: React.ReactNode;
  let actions: React.ReactNode;

  if (status.kind === "busy") {
    const p = status.progress;
    const pct = Math.round((p ? progressFraction(p) : 0) * 100);
    const label = !p
      ? t("Preparing")
      : p.phase === "buffering"
        ? t("Waiting for frames to load ({done} of {total})", { done: p.done, total: p.total })
        : p.phase === "capturing"
          ? t("Capturing frame {n} of {total}", { n: Math.min(p.done + 1, p.total), total: p.total })
          : format === "video" && videoType
            ? t("Recording video, frame {n} of {total}", { n: Math.min(p.done + 1, p.total), total: p.total })
            : t("Encoding GIF, frame {n} of {total}", { n: Math.min(p.done + 1, p.total), total: p.total });
    body = (
      <div className="space-y-3 pt-2">
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-ink">
          <Loader2 className="size-4 shrink-0 animate-spin text-ink-3" aria-hidden />
          <span className="min-w-0 tabular">{label}</span>
        </p>
        <div
          role="progressbar"
          aria-label={t("Export progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-3"
        >
          <div className="h-full rounded-[2px] bg-ink-2 transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <p className="label">{t("The map steps through each frame while it is captured. Keep Storm Central open and on screen until the export finishes.")}</p>
      </div>
    );
    actions = <Button onClick={cancel}>{t("Cancel export")}</Button>;
  } else if (status.kind === "done") {
    const { result, url, shareable } = status;
    const alt = t.plural(result.frames, "Radar loop, {n} frame", "Radar loop, {n} frames");
    body = (
      <div className="space-y-3">
        <div className="grid place-items-center overflow-hidden rounded-[var(--radius-control)] border border-line bg-black">
          {result.mimeType === "image/gif" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={alt} width={result.width} height={result.height} className="block h-auto max-h-[55vh] w-auto max-w-full" />
          ) : (
            <video src={url} autoPlay loop muted playsInline aria-label={alt} className="block h-auto max-h-[55vh] w-auto max-w-full" />
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-xs text-ink-2">{result.filename}</span>
          <span className="label shrink-0 tabular">
            {result.width} × {result.height} px, {formatBytes(result.blob.size)}
          </span>
        </div>
      </div>
    );
    actions = (
      <>
        <Button variant="ghost" onClick={() => setStatus({ kind: "idle" })} className="max-md:hidden">
          {t("Change options")}
        </Button>
        {native ? (
          <Button variant="primary" onClick={() => void saveExport(result, url, t).catch(fail)}>
            <Share2 className="size-4" aria-hidden />
            {t("Save or share")}
          </Button>
        ) : (
          <>
            {shareable && (
              <Button onClick={() => void shareExport(result, t).catch(fail)}>
                <Share2 className="size-4" aria-hidden />
                {t("Share")}
              </Button>
            )}
            <Button variant="primary" onClick={() => void saveExport(result, url, t).catch(fail)}>
              <Download className="size-4" aria-hidden />
              {t("Save")}
            </Button>
          </>
        )}
      </>
    );
  } else {
    body = (
      <div className="space-y-5">
        <div>
          <p className={FIELD_LABEL}>{t("Format")}</p>
          <Segmented<ExportFormat>
            stretch
            ariaLabel={t("Format")}
            value={format}
            onChange={(f) => {
              setFormat(f);
              if (f === "gif" && width > MAX_GIF_WIDTH) setWidth(MAX_GIF_WIDTH);
            }}
            options={[
              { value: "gif", label: "GIF" },
              { value: "video", label: t("Video"), disabled: !videoType, title: videoType ? undefined : t("Video recording isn't available in this browser") },
            ]}
          />
          <p className="label mt-2">
            {format === "video" && videoType
              ? t("{format} video. Smaller file, full colour.", { format: videoType.includes("mp4") ? "MP4" : "WebM" })
              : t("Animated GIF. Plays everywhere; larger file, 256 colours.")}
          </p>
        </div>

        <div>
          <p className={FIELD_LABEL}>{t("Size")}</p>
          <Segmented<ExportWidth>
            stretch
            ariaLabel={t("Size")}
            value={width}
            onChange={setWidth}
            options={EXPORT_WIDTHS.map((w) => ({
              value: w,
              label: t("{n} px wide", { n: w }),
              disabled: format === "gif" && w > MAX_GIF_WIDTH,
              title: format === "gif" && w > MAX_GIF_WIDTH ? t("Video only: a GIF this wide would be very large.") : undefined,
            }))}
          />
          {overlay && <p className="label mt-2">{t("With your broadcast graphics: station, radar time, lower third and ticker.")}</p>}
        </div>

        <div className="divide-y divide-line border-y border-line">
          <Row label={t("Frames")} value={n > 0 ? n : t("None yet")} sub={range ?? undefined} />
          <Row label={t("Output")} value={size ? `${size.width} × ${size.height} px` : t("Map not ready")} />
          <Row
            label={t("Timing")}
            value={t("{time} per frame", { time: seconds(delays[0]!) })}
            sub={t("Last frame held {time}", { time: seconds(delays[delays.length - 1]!) })}
          />
        </div>

        {n === 0 ? (
          <p className="label">{t("The radar loop has no frames yet. Export becomes available once scans load.")}</p>
        ) : pending > 0 ? (
          <p className="label">
            {t.plural(pending, "{n} frame is still loading. The export waits for them.", "{n} frames are still loading. The export waits for them.")}
          </p>
        ) : null}

        {status.kind === "error" && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-xs text-ink-2">
            {status.message}
          </p>
        )}
      </div>
    );
    actions = (
      <>
        <Button onClick={close} className="max-md:hidden">
          {t("Cancel")}
        </Button>
        <Button variant="primary" onClick={() => void run()} disabled={!canExport || !size}>
          <Clapperboard className="size-4" aria-hidden />
          {t("Export")}
        </Button>
      </>
    );
  }

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-loop-title"
      aria-busy={busy}
      tabIndex={-1}
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-1 pt-[env(safe-area-inset-top)] outline-none md:max-h-[min(780px,100%)] md:max-w-[520px] md:flex-none md:rounded-[var(--radius-panel)] md:border md:border-line md:pt-0"
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 12, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {header}
      <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-4 pt-4 pb-5 md:px-5 md:pt-5">{body}</div>
      <footer
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)_+_12px)] md:px-5 md:pb-3",
          "max-md:[&>*]:flex-1",
        )}
      >
        {actions}
      </footer>
    </motion.div>
  );
}
