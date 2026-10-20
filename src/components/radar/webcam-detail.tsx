"use client";

import { ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { useFormat } from "@/hooks/use-format";
import { bearingDeg, compassPoint, haversineKm, type LatLon } from "@/lib/geo";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { WEBCAM_SOURCES, webcamImage, webcamImageAt, type Webcam } from "@/lib/webcams";
import { buttonClass, IconButton } from "../ui/button";
import { HazardSwatch } from "./alert-list";

/** Cameras within this distance of the location are listed as nearby. */
export const NEARBY_CAM_KM = 100;

/** A live camera picked on the map: its latest picture (reloaded as new ones come in) and who it belongs to. */
export function WebcamDetail({
  cam,
  location,
  now,
  onClose,
  hideTitle = false,
  className,
}: {
  cam: Webcam;
  location: LatLon;
  now: number;
  onClose?: () => void;
  hideTitle?: boolean;
  className?: string;
}) {
  const t = useT();
  const fmt = useFormat();
  const info = WEBCAM_SOURCES[cam.source];
  const src = webcamImageAt(cam, now);
  // Keyed by address: a new picture (or another camera) starts loading afresh, and an error clears on the next one.
  const [state, setState] = useState<{ src: string; status: "loaded" | "error" } | null>(null);
  const status = state?.src === src ? state.status : "loading";
  const km = haversineKm(location, cam);
  const where = t("{distance} {direction} of you", { distance: fmt.distanceKm(km), direction: t(compassPoint(bearingDeg(location, cam))) });

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      {!hideTitle && (
        <div className="flex items-start gap-3">
          <HazardSwatch color={info.color} className="mt-2" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base leading-6 font-semibold break-words text-ink">{cam.name}</h3>
            <p className="text-xs text-ink-3 tabular">
              {t(info.label)} · {where}
            </p>
          </div>
          {onClose && (
            <IconButton label={t("Close camera")} size="sm" onClick={onClose} className="-mt-1 -mr-2">
              <X className="size-4" aria-hidden />
            </IconButton>
          )}
        </div>
      )}
      {hideTitle && (
        <p className="text-xs text-ink-3 tabular">
          {t(info.label)} · {where}
        </p>
      )}

      <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- third-party live stills, loaded straight from the owner */}
        <img
          key={cam.id}
          src={src}
          alt={t("Latest picture from {name}", { name: cam.name })}
          referrerPolicy="no-referrer"
          onLoad={() => setState({ src, status: "loaded" })}
          onError={() => setState({ src, status: "error" })}
          className={cn("size-full object-contain transition-opacity", status === "error" ? "opacity-0" : "opacity-100")}
        />
        {status !== "loaded" && (
          <p className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-ink-3">
            {status === "loading" ? t("Loading the latest picture") : t("This camera isn't sending pictures right now.")}
          </p>
        )}
      </div>

      <p className="label">
        {t("Image: {credit}", { credit: info.credit })} · {t("New picture about every {n} min", { n: info.refreshMin })}
      </p>
      <div className="flex flex-wrap gap-1">
        <a href={webcamImage(cam)} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
          <ExternalLink className="size-4" aria-hidden />
          {t("Full size")}
        </a>
        <a href={info.site} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
          <ExternalLink className="size-4" aria-hidden />
          {t("Camera network")}
        </a>
      </div>
    </div>
  );
}

/** The cameras closest to the location, nearest first. */
export function nearbyCams(cams: Webcam[], location: LatLon, limit = 8): { cam: Webcam; km: number }[] {
  return cams
    .map((cam) => ({ cam, km: haversineKm(location, cam) }))
    .filter((c) => c.km <= NEARBY_CAM_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/** The radar panel's "Live cameras nearby" list. */
export function WebcamList({
  cams,
  location,
  selectedId,
  onSelect,
}: {
  cams: Webcam[];
  location: LatLon;
  selectedId: string | null;
  onSelect: (cam: Webcam) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const near = nearbyCams(cams, location);
  if (!near.length) return <p className="px-4 pb-3 text-xs text-ink-3">{t("No live cameras within {distance}.", { distance: fmt.distanceKm(NEARBY_CAM_KM) })}</p>;
  return (
    <ul className="pb-1">
      {near.map(({ cam, km }) => (
        <li key={cam.id}>
          <button
            type="button"
            onClick={() => onSelect(cam)}
            aria-pressed={selectedId === cam.id}
            className={cn("flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-surface-2", selectedId === cam.id && "bg-surface-2")}
          >
            <HazardSwatch color={WEBCAM_SOURCES[cam.source].color} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{cam.name}</span>
              <span className="block text-[11px] text-ink-3">{t(WEBCAM_SOURCES[cam.source].label)}</span>
            </span>
            <span className="shrink-0 text-xs text-ink-3 tabular">{fmt.distanceKm(km)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
