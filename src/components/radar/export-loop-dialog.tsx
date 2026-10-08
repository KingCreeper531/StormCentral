"use client";

import type { Map as MlMap } from "maplibre-gl";
import { Clapperboard, Download, Loader2, Share2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { RadarLoop } from "@/hooks/use-radar-loop";
import { isNativeApp } from "@/lib/platform";
import {
  canShareExport,
  EXPORT_WIDTHS,
  exportFrameDelays,
  exportRadarLoop,
  formatBytes,
  outputSize,
  progressFraction,
  saveExport,
  shareExport,
  videoMimeType,
  type ExportFormat,
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
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Export loop" size={size} onClick={() => setOpen(true)} disabled={!props.map} className={className}>
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
function ExportPanel({ map, loop, title, subtitle, timeZone, speed = 1, onClose }: ExportLoopProps & { onClose: () => void }) {
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
  const [format, setFormat] = useState<ExportFormat>("gif");
  const [width, setWidth] = useState<ExportWidth>(EXPORT_WIDTHS[0]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const native = isNativeApp();

  // Move focus into the dialog so Escape and screen readers start there.
  useEffect(() => {
    const id = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // Stop a running export when the dialog goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

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
  const seconds = (ms: number) => `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
  const range = n > 0 ? `${clockIn(timeZone, frames[0]!.time)} to ${clockIn(timeZone, frames[n - 1]!.time)}` : null;

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

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
        speed,
        signal: ctrl.signal,
        onProgress: (progress) => setStatus({ kind: "busy", progress }),
      });
      if (ctrl.signal.aborted) return;
      setStatus({ kind: "done", result, url: URL.createObjectURL(result.blob), shareable: canShareExport(result) });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "The export failed." });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setStatus({ kind: "idle" });
  };

  const fail = (err: unknown) => setStatus({ kind: "error", message: err instanceof Error ? err.message : "Couldn't save the file." });

  const header = (
    <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-line px-3 md:flex md:h-auto md:justify-between md:py-3 md:pr-3 md:pl-5">
      <div className="md:hidden">
        <Button variant="ghost" onClick={close} className="text-accent hover:text-accent">
          {status.kind === "done" ? "Done" : "Cancel"}
        </Button>
      </div>
      <div className="min-w-0 text-center md:text-left">
        <h2 id="export-loop-title" className="truncate text-[15px] font-semibold text-ink">
          Export radar loop
        </h2>
        <p className="hidden truncate text-xs text-ink-3 md:block">Save the loop as an animated GIF or a video.</p>
      </div>
      <div className="flex justify-end">
        <IconButton label="Close" onClick={close} className="hidden md:inline-flex">
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
      ? "Preparing"
      : p.phase === "buffering"
        ? `Waiting for frames to load (${p.done} of ${p.total})`
        : p.phase === "capturing"
          ? `Capturing frame ${Math.min(p.done + 1, p.total)} of ${p.total}`
          : format === "video" && videoType
            ? `Recording video, frame ${Math.min(p.done + 1, p.total)} of ${p.total}`
            : `Encoding GIF, frame ${Math.min(p.done + 1, p.total)} of ${p.total}`;
    body = (
      <div className="space-y-3 pt-2">
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-ink">
          <Loader2 className="size-4 shrink-0 animate-spin text-ink-3" aria-hidden />
          <span className="min-w-0 tabular">{label}</span>
        </p>
        <div
          role="progressbar"
          aria-label="Export progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-3"
        >
          <div className="h-full rounded-[2px] bg-ink-2 transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <p className="label">The map steps through each frame while it is captured. Keep StormCentral open and on screen until the export finishes.</p>
      </div>
    );
    actions = <Button onClick={cancel}>Cancel export</Button>;
  } else if (status.kind === "done") {
    const { result, url, shareable } = status;
    body = (
      <div className="space-y-3">
        <div className="grid place-items-center overflow-hidden rounded-[var(--radius-control)] border border-line bg-black">
          {result.mimeType === "image/gif" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`Radar loop, ${result.frames} frames`} width={result.width} height={result.height} className="block h-auto max-h-[55vh] w-auto max-w-full" />
          ) : (
            <video src={url} autoPlay loop muted playsInline aria-label={`Radar loop, ${result.frames} frames`} className="block h-auto max-h-[55vh] w-auto max-w-full" />
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
          Change options
        </Button>
        {native ? (
          <Button variant="primary" onClick={() => void saveExport(result, url).catch(fail)}>
            <Share2 className="size-4" aria-hidden />
            Save or share
          </Button>
        ) : (
          <>
            {shareable && (
              <Button onClick={() => void shareExport(result).catch(fail)}>
                <Share2 className="size-4" aria-hidden />
                Share
              </Button>
            )}
            <Button variant="primary" onClick={() => void saveExport(result, url).catch(fail)}>
              <Download className="size-4" aria-hidden />
              Save
            </Button>
          </>
        )}
      </>
    );
  } else {
    body = (
      <div className="space-y-5">
        <div>
          <p className={FIELD_LABEL}>Format</p>
          <Segmented<ExportFormat>
            stretch
            ariaLabel="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: "gif", label: "GIF" },
              { value: "video", label: "Video", disabled: !videoType, title: videoType ? undefined : "Video recording isn't available in this browser" },
            ]}
          />
          <p className="label mt-2">
            {format === "video" && videoType
              ? `${videoType.includes("mp4") ? "MP4" : "WebM"} video. Smaller file, full colour.`
              : "Animated GIF. Plays everywhere; larger file, 256 colours."}
          </p>
        </div>

        <div>
          <p className={FIELD_LABEL}>Size</p>
          <Segmented<ExportWidth>
            stretch
            ariaLabel="Size"
            value={width}
            onChange={setWidth}
            options={EXPORT_WIDTHS.map((w) => ({ value: w, label: `${w} px wide` }))}
          />
        </div>

        <div className="divide-y divide-line border-y border-line">
          <Row label="Frames" value={n > 0 ? n : "None yet"} sub={range ?? undefined} />
          <Row label="Output" value={size ? `${size.width} × ${size.height} px` : "Map not ready"} />
          <Row label="Timing" value={`${seconds(delays[0]!)} per frame`} sub={`Last frame held ${seconds(delays[delays.length - 1]!)}`} />
        </div>

        {n === 0 ? (
          <p className="label">The radar loop has no frames yet. Export becomes available once scans load.</p>
        ) : pending > 0 ? (
          <p className="label">
            {pending === 1 ? "1 frame is" : `${pending} frames are`} still loading. The export waits for them.
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
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void run()} disabled={!canExport || !size}>
          <Clapperboard className="size-4" aria-hidden />
          Export
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
      onKeyDown={(e) => e.key === "Escape" && close()}
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
