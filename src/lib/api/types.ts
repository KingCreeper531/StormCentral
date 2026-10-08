/** Shapes returned by our own /api routes (shared by server and client). */
import type { PolygonalGeometry } from "../geo";

export interface StormMotion {
  /** Direction the storm is moving *toward*, degrees. */
  headingDeg: number;
  speedKt: number;
  /** Reference positions [lon, lat] at `time`. */
  positions: [number, number][];
  time: string;
}

export interface WeatherAlert {
  id: string;
  event: string;
  headline: string | null;
  severity: string;
  urgency: string;
  certainty: string;
  sent: string;
  effective: string;
  expires: string;
  ends: string | null;
  areaDesc: string;
  sender: string;
  description: string;
  instruction: string | null;
  hazards: {
    maxHail?: string;
    maxWind?: string;
    tornado?: string;
    damageThreat?: string;
  };
  /** e.g. "TORNADO EMERGENCY", "PDS", "OBSERVED", "DESTRUCTIVE". */
  tags: string[];
  color: string;
  rank: number;
  motion: StormMotion | null;
  geometry: PolygonalGeometry | null;
}

export interface AlertsResponse {
  alerts: WeatherAlert[];
  updated: string;
}

export interface ScansResponse {
  site: string;
  product: string;
  scans: string[];
}

export interface ProductsResponse {
  site: string;
  products: string[];
}

export interface KpPoint {
  time: string;
  kp: number;
  kind: "observed" | "estimated" | "predicted";
}

export interface SpaceWeatherResponse {
  current: KpPoint | null;
  series: KpPoint[];
  maxNext24h: number | null;
}

export interface RiverSeriesPoint {
  t: number;
  v: number;
}

export interface RiverParam {
  latest: number;
  latestTime: string;
  unit: string;
  series: RiverSeriesPoint[];
  /** Fractional change vs ~24 h earlier (meaningful for discharge). */
  change24h: number | null;
  /** Absolute change vs ~24 h earlier, in `unit` (meaningful for stage). */
  delta24h: number | null;
}

export interface RiverSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  discharge: RiverParam | null;
  gageHeight: RiverParam | null;
  waterTemp: RiverParam | null;
}

export interface RiversResponse {
  sites: RiverSite[];
  source: "usgs-iv" | "usgs-ogc";
}

export type ConstellationName = "GPS" | "GLONASS" | "Galileo" | "BeiDou";

/** Raw element sets as cached from CelesTrak (server-side only). */
export interface GnssElements {
  fetched: string;
  sets: { constellation: ConstellationName; omm: Record<string, unknown> }[];
}

/** Sky geometry computed server-side for one location. */
export interface GnssResponse {
  elementsFetched: string;
  time: number;
  count: number;
  byConstellation: Record<ConstellationName, number>;
  sats: { name: string; constellation: ConstellationName; azimuthDeg: number; elevationDeg: number }[];
  dop: { gdop: number; pdop: number; hdop: number; vdop: number } | null;
  timeline: { time: number; count: number; pdop: number | null }[];
}

/** SPC Day 1 outlook: categorical risk, or the tornado / hail / wind probabilities. */
export type OutlookKind = "categorical" | "tornado" | "hail" | "wind";

export interface OutlookFeature {
  type: "Feature";
  geometry: PolygonalGeometry;
  properties: {
    /** SPC code: "TSTM"…"HIGH" (categorical) or "0.05"…"0.60" (probabilistic). */
    label: string;
    /** Readable name: "Slight risk", "10% tornado". */
    name: string;
    fill: string;
    stroke: string;
    /** Ordering within the outlook; higher is more severe. */
    rank: number;
    /** Probabilistic only: the hatched "significant severe" (≥EF2 / ≥2" / ≥75 mph) area. */
    significant?: boolean;
  };
}

export interface OutlookResponse {
  day: 1 | 2 | 3;
  kind: OutlookKind;
  features: OutlookFeature[];
  valid: string | null;
}
