/**
 * Live cameras on the radar map: still images, refreshed every few minutes,
 * from public cameras whose owners allow showing them with credit. Shared by
 * the feed (lib/feeds/webcams), the map layer and the camera card.
 *
 * Only free sources with terms that allow it are used. Left out: HazCams
 * (no reuse without written consent), HPWREN (live images need a license),
 * FAA WeatherCams (redistribution needs an FAA agreement and token).
 *
 * State DOT cameras are listed only once the agency has said yes. Iowa DOT
 * said yes on 2026-10-27: its camera images are CC0 (credit appreciated, no
 * endorsement implied). WSDOT publishes no terms for its images and was asked
 * in October 2026; until it answers, its `approved` is false and the feed
 * leaves it out.
 */

/** Where a camera comes from. */
export type WebcamSource = "caltrans" | "alertca" | "usgs-river" | "usgs-volcano" | "iowa" | "wsdot";

export interface WebcamSourceInfo {
  /** Shown on the card and in the layer note. */
  label: string;
  /** The credit line the owner asks for, shown under every image. */
  credit: string;
  /** The owner's own camera site. */
  site: string;
  /** Marker colour. */
  color: string;
  /** How often the camera takes a new picture, roughly (minutes): the card reloads it at this pace. */
  refreshMin: number;
  /**
   * The owner has allowed showing its pictures here. Sources waiting for an
   * answer are built but off: the feed skips them. (Turning one on also
   * means naming it in the layer's note in radar-controls.)
   */
  approved: boolean;
  /**
   * Its pictures may also appear on the YouTube live stream. Kept apart from
   * `approved`: the state DOTs were only asked about pictures opened in the app.
   */
  onStream: boolean;
}

export const WEBCAM_SOURCES: Record<WebcamSource, WebcamSourceInfo> = {
  caltrans: { label: "Traffic camera", credit: "Caltrans", site: "https://quickmap.dot.ca.gov/", color: "#f5b942", refreshMin: 2, approved: true, onStream: true },
  alertca: { label: "Wildfire camera", credit: "ALERTCalifornia | UC San Diego", site: "https://cameras.alertcalifornia.org/", color: "#f97362", refreshMin: 2, approved: true, onStream: true },
  "usgs-river": { label: "River camera", credit: "USGS", site: "https://apps.usgs.gov/hivis/", color: "#4fb3ff", refreshMin: 15, approved: true, onStream: true },
  "usgs-volcano": { label: "Volcano camera", credit: "USGS Volcano Hazards Program", site: "https://volcanoes.usgs.gov/", color: "#c084fc", refreshMin: 10, approved: true, onStream: true },
  // Allowed 2026-10-27 by Iowa DOT's Traffic Operations & Safety Bureau: the images are CC0, credit welcome
  // ("Source: Iowa DOT"). We keep to what we asked: at most one picture per 5 minutes while a camera is open.
  iowa: { label: "Traffic camera", credit: "Iowa DOT", site: "https://511ia.org/", color: "#f5b942", refreshMin: 5, approved: true, onStream: true },
  // Asked 2026-10-21 (the camera layer's data contact): WSDOT's own cameras only, images refresh about every 5 minutes.
  wsdot: { label: "Traffic camera", credit: "WSDOT", site: "https://wsdot.com/travel/real-time/map/", color: "#f5b942", refreshMin: 5, approved: false, onStream: false },
};

export const WEBCAM_SOURCE_IDS = Object.keys(WEBCAM_SOURCES) as WebcamSource[];

/**
 * One camera on the wire: [source, key, lat, lon, name]. The key is enough to
 * build the image address (see webcamImage), which keeps the nationwide list
 * small: several thousand cameras in about 100 KB gzipped.
 */
export type WebcamRow = [source: WebcamSource, key: string, lat: number, lon: number, name: string];

export interface WebcamsResponse {
  cams: WebcamRow[];
  /** Sources that couldn't be loaded this time (their cameras are missing). */
  unavailable: WebcamSource[];
  updated: string;
}

export interface Webcam {
  /** `${source}:${key}`, unique across sources. */
  id: string;
  source: WebcamSource;
  key: string;
  lat: number;
  lon: number;
  name: string;
}

export const webcamId = (source: WebcamSource, key: string) => `${source}:${key}`;

export function toWebcam([source, key, lat, lon, name]: WebcamRow): Webcam {
  return { id: webcamId(source, key), source, key, lat, lon, name };
}

/** The camera's latest picture. */
export function webcamImage(cam: Pick<Webcam, "source" | "key">): string {
  const k = cam.key;
  switch (cam.source) {
    case "caltrans": {
      // "7/i110196avenue26offramp": district and the camera's file name.
      const [district, slug] = k.split("/");
      return `https://cwwp2.dot.ca.gov/data/d${district}/cctv/image/${slug}/${slug}.jpg`;
    }
    case "alertca":
      return `https://cameras.alertcalifornia.org/public-camera-data/${encodeURIComponent(k)}/latest-frame.jpg`;
    case "usgs-river":
      return `https://usgs-nims-images.s3.amazonaws.com/720/${encodeURIComponent(k)}/${encodeURIComponent(k)}_newest.jpg`;
    case "usgs-volcano":
      return `https://volcview.wr.usgs.gov/ashcam-api/images/webcams/${encodeURIComponent(k)}/current-medium.jpg`;
    case "iowa":
      // "Metro/ictv29hd.jpeg": the snapshot folder and file.
      return `https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/${k}`;
    case "wsdot":
      // "sw/005vc00320.jpg": the region folder and file.
      return `https://images.wsdot.wa.gov/${k}`;
  }
}

/** The picture, with a parameter that changes every `refreshMin` so browsers fetch the new one instead of a cached copy. */
export function webcamImageAt(cam: Pick<Webcam, "source" | "key">, now: number): string {
  const step = WEBCAM_SOURCES[cam.source].refreshMin * 60_000;
  return `${webcamImage(cam)}?t=${Math.floor(now / step)}`;
}
