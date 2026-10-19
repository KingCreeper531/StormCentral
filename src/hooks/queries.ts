"use client";

/**
 * Data hooks. Query keys round coordinates to ~1 km so tiny GPS jitter
 * doesn't bust the cache; refetch intervals come from the mode registry so
 * the active mode polls its feeds hard while everything else idles.
 */
import { keepPreviousData, useInfiniteQuery, useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import { getJson } from "@/lib/api/http";
import { COMMUNITY_ENABLED, IS_STATIC_BUNDLE } from "@/lib/platform";
import { fetchAirGrid, fetchAirQuality, fetchRecentPrecip, type GridVariable } from "@/lib/api/open-meteo";
import { keyTag, loadForecast } from "@/lib/forecast-load";
import { translator } from "@/lib/i18n/core";
import { currentLang } from "@/lib/i18n/use-t";
import type {
  AlertsResponse,
  GnssResponse,
  OutlookKind,
  OutlookResponse,
  ProductsResponse,
  RiversResponse,
  ScansResponse,
  SpaceWeatherResponse,
} from "@/lib/api/types";
import type { FeedResponse, PostDto } from "@/lib/community";
import type { StormCellsResponse } from "@/lib/feeds/storm-cells";
import type { StormEtaResponse } from "@/lib/storm-eta";
import type { StormReportsResponse } from "@/lib/feeds/storm-reports";
import type { TropicalResponse } from "@/lib/feeds/tropical";
import type { BBox, LatLon } from "@/lib/geo";
import { MAX_GAUGE_RADIUS_KM, useAppStore } from "@/store/app-store";
import { pollFor, type Feed, type ModeId } from "@/modes/registry";
import type { IntlTimesResponse, NoaaTimesResponse } from "@/lib/feeds/radar";
import type { IntlRadarId } from "@/lib/radar/intl";
import type { ClimateResponse } from "@/lib/feeds/climate";
import type { FloodGaugesResponse } from "@/lib/feeds/flood-gauges";
import type { ForecasterNotesResponse } from "@/lib/feeds/forecaster-notes";
import type { WildfiresResponse } from "@/lib/feeds/wildfires";
import type { HazardsResponse } from "@/lib/feeds/hazards";
import type { AlertTextResponse } from "@/lib/feeds/alerts";
import type { WeatherAlert } from "@/lib/api/types";
import type { SpotterWarningsResponse } from "@/lib/warngen/schema";
import type { ChasersResponse } from "@/lib/chasers";
import type { ChaserStreamsResponse } from "@/lib/chaser-streams";

// Request URLs use the same rounding as their query keys, so nearby users share the CDN's cached response.
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const q4 = (v: number) => Math.round(v * 4) / 4;

export const qk = {
  /**
   * Includes the chosen source (and, for Google, which key), so switching never shows the wrong one.
   * Not the language: switching it mustn't refetch or lose the forecast saved for offline use (a
   * fallback notice catches up on the next refresh).
   */
  forecast: (p: LatLon) => {
    const { forecastSource, googleKey } = useAppStore.getState();
    return ["forecast", r2(p.lat), r2(p.lon), forecastSource, forecastSource === "google" ? keyTag(googleKey.trim()) : ""] as const;
  },
  air: (p: LatLon) => ["air", r2(p.lat), r2(p.lon)] as const,
  airGrid: (b: BBox, v: GridVariable) => ["airGrid", v, b.west.toFixed(1), b.south.toFixed(1), b.east.toFixed(1), b.north.toFixed(1)] as const,
  localAlerts: (p: LatLon) => ["alerts", "local", r2(p.lat), r2(p.lon)] as const,
  nationalAlerts: ["alerts", "national"] as const,
  scans: (site: string, product: string, minutes: number) => ["scans", site, product, minutes] as const,
  products: (site: string) => ["products", site] as const,
  kp: ["kp"] as const,
  rivers: (p: LatLon) => ["rivers", r2(p.lat), r2(p.lon)] as const,
  gnss: (p: LatLon) => ["gnss", q4(p.lat), q4(p.lon)] as const,
  outlook: (day: number, kind: OutlookKind) => ["outlook", day, kind] as const,
  stormReports: (hours: number) => ["stormReports", hours] as const,
  stormCells: ["stormCells"] as const,
  tropical: ["tropical"] as const,
  recentPrecip: (p: LatLon) => ["recentPrecip", r2(p.lat), r2(p.lon)] as const,
  floodGauges: (p: LatLon, radiusKm: number) => ["floodGauges", r1(p.lat), r1(p.lon), radiusKm] as const,
  forecasterNotes: (p: LatLon) => ["forecasterNotes", r2(p.lat), r2(p.lon)] as const,
  climate: (p: LatLon) => ["climate", Math.round(p.lat * 4) / 4, Math.round(p.lon * 4) / 4] as const,
  wildfires: (p: LatLon) => ["wildfires", Math.round(p.lat * 4) / 4, Math.round(p.lon * 4) / 4] as const,
  session: ["session"] as const,
  spotterWarnings: ["spotterWarnings"] as const,
  chasers: ["chasers"] as const,
  posts: (params: Record<string, string>) => ["posts", params] as const,
};

function usePoll(feed: Feed) {
  const mode = useAppStore((s) => s.mode);
  const hydrated = useAppStore((s) => s.hydrated);
  const interval = pollFor(feed, mode);
  return { enabled: hydrated && interval !== false, refetchInterval: interval === false ? undefined : interval };
}

export function useForecast() {
  const loc = useAppStore((s) => s.location);
  const source = useAppStore((s) => s.forecastSource);
  const googleKey = useAppStore((s) => s.googleKey.trim());
  const { enabled, refetchInterval } = usePoll("forecast");
  // Google's free tier is per key (10,000 calls a month, 4 per refresh): refresh it at most every 30 minutes.
  const google = source === "google" && !!googleKey;
  return useQuery({
    queryKey: qk.forecast(loc),
    queryFn: ({ signal }) => loadForecast(loc.lat, loc.lon, source, googleKey, signal, translator(currentLang())),
    enabled,
    // After a failed load (the service busy, the connection gone), keep trying every minute
    // instead of waiting for the next scheduled refresh.
    refetchInterval: (q) =>
      !enabled ? false : q.state.status === "error" ? 60_000 : google && refetchInterval ? Math.max(refetchInterval, 30 * 60_000) : (refetchInterval ?? false),
    staleTime: google ? 30 * 60_000 : 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useAirQuality(force = false) {
  const loc = useAppStore((s) => s.location);
  const hydrated = useAppStore((s) => s.hydrated);
  const { enabled, refetchInterval } = usePoll("air");
  return useQuery({
    queryKey: qk.air(loc),
    queryFn: ({ signal }) => fetchAirQuality(loc.lat, loc.lon, signal),
    enabled: hydrated && (enabled || force),
    refetchInterval,
    staleTime: 15 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Open-Meteo counts every grid point as one API call (free limit about 600 a
 * minute per IP), so the grid is small and snapped outward to whole degrees:
 * small pans reuse the cached grid instead of spending another ~80 calls.
 */
export function useAirGrid(view: BBox | null, variable: GridVariable, { pad = 0 }: { pad?: number } = {}) {
  // `pad` widens the sampled area by that fraction on each side, so small zooms and pans stay covered.
  const w = view ? (view.east - view.west) * pad : 0;
  const h = view ? (view.north - view.south) * pad : 0;
  const bbox = view && {
    west: Math.floor(view.west - w),
    south: Math.floor(view.south - h),
    east: Math.ceil(view.east + w),
    north: Math.ceil(view.north + h),
  };
  return useQuery({
    queryKey: bbox ? qk.airGrid(bbox, variable) : ["airGrid", "none"],
    queryFn: ({ signal }) => fetchAirGrid(bbox!, variable, 10, 8, signal),
    enabled: !!bbox,
    staleTime: 20 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useLocalAlerts() {
  const loc = useAppStore((s) => s.location);
  const { enabled, refetchInterval } = usePoll("localAlerts");
  return useQuery({
    queryKey: qk.localAlerts(loc),
    queryFn: ({ signal }) => getJson<AlertsResponse>(`/api/alerts?lat=${loc.lat}&lon=${loc.lon}`, { signal }),
    enabled,
    refetchInterval,
    staleTime: 60_000,
  });
}

export function useNationalAlerts(force = false) {
  const hydrated = useAppStore((s) => s.hydrated);
  const { enabled, refetchInterval } = usePoll("nationalAlerts");
  return useQuery({
    queryKey: qk.nationalAlerts,
    queryFn: ({ signal }) => getJson<AlertsResponse>("/api/alerts?scope=national", { signal, timeoutMs: 25_000 }),
    enabled: hydrated && (enabled || force),
    refetchInterval: refetchInterval ?? (force ? 60_000 : undefined),
    staleTime: 40_000,
  });
}

/**
 * Every hazard polygon (watches, advisories, statements, marine, SPC/WPC
 * discussions, other countries' warnings) for the radar maps. Polls gently:
 * these products change far less often than storm-based warnings.
 */
export function useHazards(enabled: boolean) {
  const hydrated = useAppStore((s) => s.hydrated);
  const intl = useAppStore((s) => s.radar.intlAlerts);
  const sources = intl ? "nws,spc,wpc,eccc,dwd" : "nws,spc,wpc";
  return useQuery({
    queryKey: ["hazards", sources] as const,
    queryFn: ({ signal }) => getJson<HazardsResponse>(`/api/hazards?sources=${sources}`, { signal, timeoutMs: 40_000 }),
    enabled: hydrated && enabled,
    // On the phone app the feed runs on the device (a couple of MB per refresh): poll less.
    refetchInterval: IS_STATIC_BUNDLE ? 5 * 60_000 : 2 * 60_000,
    staleTime: 90_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * The full text of a hazard-map alert, which arrives without it: the NWS
 * alert from api.weather.gov, or an SPC/WPC discussion from IEM's archive.
 */
export function useAlertText(alert: WeatherAlert | null | undefined) {
  const product = alert?.lean && alert.url?.includes("/nwstext/") ? alert.url.split("/nwstext/")[1] : null;
  const id = alert?.lean && alert.source === "nws" ? alert.id : null;
  return useQuery({
    queryKey: ["alertText", id ?? product ?? "-"] as const,
    queryFn: ({ signal }) => getJson<AlertTextResponse>(id ? `/api/alerts?id=${encodeURIComponent(id)}` : `/api/alerts?product=${encodeURIComponent(product!)}`, { signal }),
    enabled: !!(id || product),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/** MRMS / super-res NEXRAD times from NOAA (lib/radar/noaa), when that source is in use. */
export function useNoaaTimes(layer: { workspace: string; layer: string } | null, minutes: number, enabled: boolean) {
  const { refetchInterval } = usePoll("radar");
  const hydrated = useAppStore((s) => s.hydrated);
  return useQuery({
    queryKey: ["noaa-times", layer?.workspace ?? "-", layer?.layer ?? "-", minutes] as const,
    queryFn: ({ signal }) => getJson<NoaaTimesResponse>(`/api/radar/noaa?workspace=${layer!.workspace}&layer=${layer!.layer}&minutes=${minutes}`, { signal }),
    enabled: hydrated && enabled && !!layer,
    // MRMS updates every 2 minutes.
    refetchInterval: refetchInterval ?? 60_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useRadarScans(site: string | null, product: string, minutes: number) {
  // Only mounted by radar views, so availability is gated by the component tree;
  // the mode only decides how hard to poll.
  const { refetchInterval } = usePoll("radar");
  const hydrated = useAppStore((s) => s.hydrated);
  return useQuery({
    queryKey: qk.scans(site ?? "-", product, minutes),
    queryFn: ({ signal }) =>
      getJson<ScansResponse>(`/api/radar/scans?site=${site}&product=${product}&minutes=${minutes}`, { signal }),
    enabled: hydrated && !!site,
    refetchInterval: refetchInterval ?? 2 * 60_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useRadarProducts(site: string | null) {
  return useQuery({
    queryKey: qk.products(site ?? "-"),
    queryFn: ({ signal }) => getJson<ProductsResponse>(`/api/radar/products?site=${site}`, { signal }),
    enabled: !!site,
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

export function useSpaceWeather() {
  const { enabled, refetchInterval } = usePoll("kp");
  return useQuery({
    queryKey: qk.kp,
    queryFn: ({ signal }) => getJson<SpaceWeatherResponse>("/api/space-weather", { signal }),
    enabled,
    refetchInterval,
    staleTime: 10 * 60_000,
  });
}

export function useRivers() {
  const loc = useAppStore((s) => s.location);
  const radiusKm = Math.round(Math.min(MAX_GAUGE_RADIUS_KM, useAppStore((s) => s.radiusKm)));
  const { enabled, refetchInterval } = usePoll("rivers");
  return useQuery({
    queryKey: [...qk.rivers(loc), radiusKm],
    queryFn: ({ signal }) => getJson<RiversResponse>(`/api/rivers?lat=${r2(loc.lat)}&lon=${r2(loc.lon)}&radiusKm=${radiusKm}`, { signal, timeoutMs: 25_000 }),
    enabled,
    refetchInterval,
    staleTime: 5 * 60_000,
  });
}

export function useGnss() {
  const loc = useAppStore((s) => s.location);
  const { enabled, refetchInterval } = usePoll("gnss");
  return useQuery({
    queryKey: qk.gnss(loc),
    queryFn: ({ signal }) => getJson<GnssResponse>(`/api/gnss?lat=${q4(loc.lat)}&lon=${q4(loc.lon)}`, { signal, timeoutMs: 30_000 }),
    enabled,
    refetchInterval,
    staleTime: 5 * 60_000,
  });
}

export function useOutlook(enabled: boolean, kind: OutlookKind = "categorical") {
  const { enabled: polling, refetchInterval } = usePoll("outlook");
  return useQuery({
    queryKey: qk.outlook(1, kind),
    queryFn: ({ signal }) => getJson<OutlookResponse>(`/api/outlook?day=1&kind=${kind}`, { signal }),
    enabled: enabled && polling,
    refetchInterval,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Official NWS local storm reports over the last `hours`. */
export function useStormReports(enabled: boolean, hours = 6) {
  const { enabled: polling, refetchInterval } = usePoll("stormReports");
  return useQuery({
    queryKey: qk.stormReports(hours),
    queryFn: ({ signal }) => getJson<StormReportsResponse>(`/api/storm-reports?hours=${hours}`, { signal, timeoutMs: 25_000 }),
    enabled: enabled && polling,
    refetchInterval,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Latest NEXRAD storm-cell attributes (hail, rotation, motion). */
export function useStormCells(enabled: boolean) {
  const { enabled: polling, refetchInterval } = usePoll("stormCells");
  return useQuery({
    queryKey: qk.stormCells,
    queryFn: ({ signal }) => getJson<StormCellsResponse>("/api/storm-cells", { signal, timeoutMs: 25_000 }),
    enabled: enabled && polling,
    refetchInterval,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Active tropical cyclones (NHC). */
export function useTropical(enabled: boolean) {
  const { enabled: polling, refetchInterval } = usePoll("tropical");
  return useQuery({
    queryKey: qk.tropical,
    queryFn: ({ signal }) => getJson<TropicalResponse>("/api/tropical", { signal, timeoutMs: 30_000 }),
    enabled: enabled && polling,
    refetchInterval,
    staleTime: 10 * 60_000,
  });
}

/** Rainfall over the last 31 days and the next 3 (Open-Meteo, direct). */
export function useRecentPrecip() {
  const loc = useAppStore((s) => s.location);
  const { enabled, refetchInterval } = usePoll("recentPrecip");
  return useQuery({
    queryKey: qk.recentPrecip(loc),
    queryFn: ({ signal }) => fetchRecentPrecip(loc.lat, loc.lon, signal),
    enabled,
    refetchInterval,
    staleTime: 15 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** NWS river forecast points near the location, with flood stages. */
export function useFloodGauges() {
  const loc = useAppStore((s) => s.location);
  const radiusKm = Math.round(Math.min(MAX_GAUGE_RADIUS_KM, useAppStore((s) => s.radiusKm)));
  const { enabled, refetchInterval } = usePoll("floodGauges");
  return useQuery({
    queryKey: qk.floodGauges(loc, radiusKm),
    queryFn: ({ signal }) => getJson<FloodGaugesResponse>(`/api/flood-gauges?lat=${r1(loc.lat)}&lon=${r1(loc.lon)}&radiusKm=${radiusKm}`, { signal, timeoutMs: 30_000 }),
    enabled,
    refetchInterval,
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/** The local NWS office's latest forecast discussion (US only: 404 elsewhere). */
export function useForecasterNotes() {
  const loc = useAppStore((s) => s.location);
  const { enabled, refetchInterval } = usePoll("forecasterNotes");
  return useQuery({
    queryKey: qk.forecasterNotes(loc),
    queryFn: ({ signal }) => getJson<ForecasterNotesResponse>(`/api/forecaster-notes?lat=${r2(loc.lat)}&lon=${r2(loc.lon)}`, { signal, timeoutMs: 25_000 }),
    enabled,
    refetchInterval,
    staleTime: 10 * 60_000,
  });
}

/** Normals and records from the nearest long-record station (US). */
export function useClimate() {
  const loc = useAppStore((s) => s.location);
  const { enabled } = usePoll("climate");
  const lat = Math.round(loc.lat * 4) / 4;
  const lon = Math.round(loc.lon * 4) / 4;
  return useQuery({
    queryKey: qk.climate(loc),
    queryFn: ({ signal }) => getJson<ClimateResponse>(`/api/climate?lat=${lat}&lon=${lon}`, { signal, timeoutMs: 60_000 }),
    enabled,
    staleTime: 24 * 3_600_000,
    gcTime: 24 * 3_600_000,
    retry: 1,
  });
}

/** Uncontained wildfires within 250 km (US). */
export function useWildfires() {
  const loc = useAppStore((s) => s.location);
  const { enabled, refetchInterval } = usePoll("wildfires");
  const lat = Math.round(loc.lat * 4) / 4;
  const lon = Math.round(loc.lon * 4) / 4;
  return useQuery({
    queryKey: qk.wildfires(loc),
    queryFn: ({ signal }) => getJson<WildfiresResponse>(`/api/wildfires?lat=${lat}&lon=${lon}`, { signal, timeoutMs: 30_000 }),
    enabled,
    refetchInterval,
    staleTime: 15 * 60_000,
    retry: 1,
  });
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  avatarUrl: string | null;
  moderator: boolean;
  suspendedUntil: number | null;
}

export function useSession() {
  return useQuery({
    queryKey: qk.session,
    queryFn: ({ signal }) => getJson<{ user: SessionUser | null }>("/api/auth/me", { signal }).then((r) => r.user),
    enabled: COMMUNITY_ENABLED,
    staleTime: 5 * 60_000,
  });
}

/** Whether the server sends reports on to NOAA's mPING; asked only while the composer is open. */
export function useMpingEnabled(enabled: boolean) {
  return useQuery({
    queryKey: ["mping"],
    queryFn: ({ signal }) => getJson<{ mping?: boolean }>("/api/auth/me", { signal }).then((r) => r.mping === true),
    enabled: COMMUNITY_ENABLED && enabled,
    staleTime: 60 * 60_000,
  });
}

export function useFeed(params: Record<string, string>) {
  return useInfiniteQuery({
    queryKey: qk.posts(params),
    queryFn: ({ pageParam, signal }) =>
      getJson<FeedResponse>(`/api/posts?${new URLSearchParams({ ...params, ...(pageParam ? { cursor: pageParam } : {}) })}`, {
        signal,
      }),
    initialPageParam: "" as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: COMMUNITY_ENABLED,
    staleTime: 30_000,
  });
}

export function useReportsInView(bbox: BBox | null, enabled: boolean) {
  return useQuery<PostDto[]>({
    queryKey: ["posts", "bbox", bbox && [bbox.west, bbox.south, bbox.east, bbox.north].map((v) => v.toFixed(1)).join(",")],
    queryFn: ({ signal }) =>
      getJson<FeedResponse>(
        `/api/posts?sort=bbox&hours=6&bbox=${[bbox!.west, bbox!.south, bbox!.east, bbox!.north].map((v) => v.toFixed(3)).join(",")}`,
        { signal },
      ).then((r) => r.posts),
    enabled: COMMUNITY_ENABLED && enabled && !!bbox,
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Warm the caches a mode needs (called on mode-tab hover/focus) so the
 * switch renders with data instead of skeletons.
 */
export function prefetchMode(qc: QueryClient, mode: ModeId, loc: LatLon) {
  const opts = { staleTime: 60_000 };
  if (mode === "air") void qc.prefetchQuery({ queryKey: qk.air(loc), queryFn: ({ signal }) => fetchAirQuality(loc.lat, loc.lon, signal), ...opts });
  if (mode === "severe" || mode === "professional")
    void qc.prefetchQuery({ queryKey: qk.nationalAlerts, queryFn: ({ signal }) => getJson<AlertsResponse>("/api/alerts?scope=national", { signal, timeoutMs: 25_000 }), ...opts });
  if (mode === "drone") {
    void qc.prefetchQuery({ queryKey: qk.kp, queryFn: ({ signal }) => getJson<SpaceWeatherResponse>("/api/space-weather", { signal }), ...opts });
    void qc.prefetchQuery({ queryKey: qk.gnss(loc), queryFn: ({ signal }) => getJson<GnssResponse>(`/api/gnss?lat=${q4(loc.lat)}&lon=${q4(loc.lon)}`, { signal }), ...opts });
  }
  if (mode === "angler")
    void qc.prefetchQuery({ queryKey: qk.rivers(loc), queryFn: ({ signal }) => getJson<RiversResponse>(`/api/rivers?lat=${r2(loc.lat)}&lon=${r2(loc.lon)}`, { signal }), ...opts });
}

/** Strong radar storms heading for the selected location within the hour (every 2 minutes while the page shows). */
export function useIncomingStorms() {
  const loc = useAppStore((s) => s.location);
  const hydrated = useAppStore((s) => s.hydrated);
  return useQuery({
    queryKey: ["stormEta", r2(loc.lat), r2(loc.lon)] as const,
    queryFn: ({ signal }) => getJson<StormEtaResponse>(`/api/storm-eta?lat=${r2(loc.lat)}&lon=${r2(loc.lon)}`, { signal }),
    enabled: hydrated,
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
  });
}

/** Times of other countries' radar composites (lib/radar/intl), one query per source. */
export function useIntlTimes(sources: readonly IntlRadarId[], minutes: number) {
  const hydrated = useAppStore((s) => s.hydrated);
  return useQueries({
    queries: sources.map((src) => ({
      queryKey: ["intl-times", src, minutes] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => getJson<IntlTimesResponse>(`/api/radar/intl?src=${src}&minutes=${minutes}`, { signal }),
      enabled: hydrated,
      refetchInterval: 2 * 60_000,
      staleTime: 60_000,
    })),
  });
}

/**
 * Spotter-network warnings (Professional mode's WarnGen): members only, so
 * nothing is fetched until someone is signed in.
 */
export function useSpotterWarnings(enabled = true) {
  const session = useSession();
  return useQuery({
    queryKey: qk.spotterWarnings,
    queryFn: ({ signal }) => getJson<SpotterWarningsResponse>("/api/spotter-warnings", { signal }),
    enabled: COMMUNITY_ENABLED && enabled && !!session.data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Storm chasers sharing their live position (members only, like spotter
 * warnings). Polled each minute while the map layer is on; TanStack pauses
 * the poll while the tab is hidden.
 */
/** Storm chasers live on YouTube (the radar's Chasers panel, and LIVE on the chasers layer). Needs the server. */
export function useChaserStreams(enabled: boolean) {
  return useQuery({
    queryKey: ["chaserStreams"],
    queryFn: ({ signal }) => getJson<ChaserStreamsResponse>("/api/chaser-streams", { signal }),
    enabled: !IS_STATIC_BUNDLE && enabled,
    refetchInterval: 2 * 60_000,
    staleTime: 60_000,
  });
}

export function useChasers(enabled: boolean) {
  const session = useSession();
  return useQuery({
    queryKey: qk.chasers,
    queryFn: ({ signal }) => getJson<ChasersResponse>("/api/chasers", { signal }),
    enabled: COMMUNITY_ENABLED && enabled && !!session.data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
