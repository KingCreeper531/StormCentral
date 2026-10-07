"use client";

/**
 * Data hooks. Query keys round coordinates to ~1 km so tiny GPS jitter
 * doesn't bust the cache; refetch intervals come from the mode registry so
 * the active mode polls its feeds hard while everything else idles.
 */
import { keepPreviousData, useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query";
import { getJson } from "@/lib/api/http";
import { fetchAirGrid, fetchAirQuality, fetchForecast, type GridVariable } from "@/lib/api/open-meteo";
import type {
  AlertsResponse,
  GnssResponse,
  OutlookResponse,
  ProductsResponse,
  RiversResponse,
  ScansResponse,
  SpaceWeatherResponse,
} from "@/lib/api/types";
import type { FeedResponse, PostDto } from "@/lib/community";
import type { BBox, LatLon } from "@/lib/geo";
import { useAppStore } from "@/store/app-store";
import { pollFor, type Feed, type ModeId } from "@/modes/registry";

const r2 = (v: number) => Math.round(v * 100) / 100;

export const qk = {
  forecast: (p: LatLon) => ["forecast", r2(p.lat), r2(p.lon)] as const,
  air: (p: LatLon) => ["air", r2(p.lat), r2(p.lon)] as const,
  airGrid: (b: BBox, v: GridVariable) => ["airGrid", v, b.west.toFixed(1), b.south.toFixed(1), b.east.toFixed(1), b.north.toFixed(1)] as const,
  localAlerts: (p: LatLon) => ["alerts", "local", r2(p.lat), r2(p.lon)] as const,
  nationalAlerts: ["alerts", "national"] as const,
  scans: (site: string, product: string, minutes: number) => ["scans", site, product, minutes] as const,
  products: (site: string) => ["products", site] as const,
  kp: ["kp"] as const,
  rivers: (p: LatLon) => ["rivers", r2(p.lat), r2(p.lon)] as const,
  gnss: (p: LatLon) => ["gnss", Math.round(p.lat * 4) / 4, Math.round(p.lon * 4) / 4] as const,
  outlook: (day: number) => ["outlook", day] as const,
  session: ["session"] as const,
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
  const { enabled, refetchInterval } = usePoll("forecast");
  return useQuery({
    queryKey: qk.forecast(loc),
    queryFn: ({ signal }) => fetchForecast(loc.lat, loc.lon, signal),
    enabled,
    refetchInterval,
    staleTime: 5 * 60_000,
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

export function useAirGrid(bbox: BBox | null, variable: GridVariable) {
  return useQuery({
    queryKey: bbox ? qk.airGrid(bbox, variable) : ["airGrid", "none"],
    queryFn: ({ signal }) => fetchAirGrid(bbox!, variable, 14, 10, signal),
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
  const { enabled, refetchInterval } = usePoll("rivers");
  return useQuery({
    queryKey: qk.rivers(loc),
    queryFn: ({ signal }) => getJson<RiversResponse>(`/api/rivers?lat=${loc.lat}&lon=${loc.lon}`, { signal, timeoutMs: 25_000 }),
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
    queryFn: ({ signal }) => getJson<GnssResponse>(`/api/gnss?lat=${loc.lat}&lon=${loc.lon}`, { signal, timeoutMs: 30_000 }),
    enabled,
    refetchInterval,
    staleTime: 5 * 60_000,
  });
}

export function useOutlook(enabled: boolean) {
  return useQuery({
    queryKey: qk.outlook(1),
    queryFn: ({ signal }) => getJson<OutlookResponse>("/api/outlook?day=1", { signal }),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
}

export function useSession() {
  return useQuery({
    queryKey: qk.session,
    queryFn: ({ signal }) => getJson<{ user: SessionUser | null }>("/api/auth/me", { signal }).then((r) => r.user),
    staleTime: 5 * 60_000,
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
    enabled: enabled && !!bbox,
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
  if (mode === "severe")
    void qc.prefetchQuery({ queryKey: qk.nationalAlerts, queryFn: ({ signal }) => getJson<AlertsResponse>("/api/alerts?scope=national", { signal, timeoutMs: 25_000 }), ...opts });
  if (mode === "drone") {
    void qc.prefetchQuery({ queryKey: qk.kp, queryFn: ({ signal }) => getJson<SpaceWeatherResponse>("/api/space-weather", { signal }), ...opts });
    void qc.prefetchQuery({ queryKey: qk.gnss(loc), queryFn: ({ signal }) => getJson<GnssResponse>(`/api/gnss?lat=${loc.lat}&lon=${loc.lon}`, { signal }), ...opts });
  }
  if (mode === "angler")
    void qc.prefetchQuery({ queryKey: qk.rivers(loc), queryFn: ({ signal }) => getJson<RiversResponse>(`/api/rivers?lat=${loc.lat}&lon=${loc.lon}`, { signal }), ...opts });
}
