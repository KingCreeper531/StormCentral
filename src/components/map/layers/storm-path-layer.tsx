"use client";

import type { Feature, FeatureCollection } from "geojson";
import type { MapStyleImageMissingEvent, Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import type { WeatherAlert } from "@/lib/api/types";
import { useT } from "@/lib/i18n/use-t";
import { stormPaths, townsInPath, type PathPlace, type PathTown } from "@/lib/storm-path";
import { clockIn } from "@/lib/weather/view";
import { useStormPathStore } from "@/store/storm-path-store";
import { mapAlive, SLOTS, useMapContext } from "../map-view";
import { pathCallout } from "./storm-path-callout";
import { PATH_SRC, pathCalloutId, stormPathLayers } from "./storm-path-style";
import { useGeoJsonLayers } from "./use-geojson-source";

/** Warnings whose motion line gives a storm to follow. */
const PATH_EVENTS = new Set(["Tornado Warning", "Severe Thunderstorm Warning", "Extreme Wind Warning", "Snow Squall Warning"]);
/** Callouts per path: the soonest towns, so the map stays readable. */
const MAX_CALLOUTS = 8;
const SIZE: Record<string, number> = { city: 0, town: 1, village: 2 };

/**
 * The basemap's towns in the tiles on screen: the towns a path can name, with no data of our own. Both tile
 * schemas: Protomaps (CARTO's now: "places", kind locality, kind_detail city/town/village) and OpenMapTiles
 * (MapTiler: "place", class city/town/village).
 */
function basemapPlaces(map: MlMap): PathPlace[] {
  const source = Object.entries(map.getStyle()?.sources ?? {}).find(([, s]) => s.type === "vector")?.[0];
  if (!source) return [];
  const seen = new Set<string>();
  const out: PathPlace[] = [];
  const features = [
    ...map.querySourceFeatures(source, { sourceLayer: "places" }).filter((f) => f.properties?.kind === "locality").map((f) => [f, f.properties?.kind_detail] as const),
    ...map.querySourceFeatures(source, { sourceLayer: "place" }).map((f) => [f, f.properties?.class] as const),
  ];
  for (const [f, detail] of features) {
    const p = f.properties ?? {};
    const size = SIZE[String(detail)];
    const name = String(p["name:en"] || p.name_en || p["name:latin"] || p.name || "");
    if (size == null || !name || f.geometry.type !== "Point") continue;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    // The same town comes from every tile it sits near.
    const key = `${name}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, size, lat, lon });
  }
  return out;
}

/**
 * Storm tracking for every warned storm that's moving: its path an hour ahead
 * in the warning's colour, a cone for the uncertainty, its position now, the
 * clock time every 15 minutes, and a callout on each town in the path with the
 * time the storm gets there. The selected warning and tornadoes stand out; the
 * towns also go to the warning's details (store/storm-path-store).
 */
export function StormPathLayer({ alerts, selectedId, now, timeZone }: { alerts: WeatherAlert[]; selectedId: string | null; now: number; timeZone?: string }) {
  const { map } = useMapContext();
  const t = useT();
  const setTowns = useStormPathStore((s) => s.setTowns);
  const [places, setPlaces] = useState<PathPlace[]>([]);

  // Towns come from the tiles on screen, so they're read again whenever the map settles.
  useEffect(() => {
    if (!mapAlive(map)) return;
    const read = () => mapAlive(map) && setPlaces(basemapPlaces(map));
    read();
    map.on("idle", read);
    return () => {
      map.off("idle", read);
    };
  }, [map]);

  const tracked = useMemo(() => alerts.filter((a) => a.motion && PATH_EVENTS.has(a.event)), [alerts]);

  const towns = useMemo(() => {
    const out: Record<string, PathTown[]> = {};
    for (const a of tracked) {
      const list = townsInPath(a.motion!, places, now, Date.parse(a.ends ?? a.expires));
      if (list.length) out[a.id] = list;
    }
    return out;
  }, [tracked, places, now]);

  useEffect(() => {
    setTowns(towns);
  }, [towns, setTowns]);
  useEffect(() => () => setTowns({}), [setTowns]);

  const data = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    for (const a of tracked) {
      const focus = a.id === selectedId || a.event === "Tornado Warning";
      const props = { color: a.color, focus };
      for (const path of stormPaths(a.motion!, now, Date.parse(a.ends ?? a.expires))) {
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [path.cone] }, properties: { ...props, kind: "cone" } });
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: path.line }, properties: { ...props, kind: "line" } });
        for (const m of path.marks)
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [m.lon, m.lat] },
            properties: { ...props, kind: m.minutes === 0 ? "now" : "mark", label: clockIn(timeZone, m.at, t.locale) },
          });
      }
      if (!focus) continue;
      for (const town of (towns[a.id] ?? []).slice(0, MAX_CALLOUTS))
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [town.lon, town.lat] },
          properties: { ...props, kind: "town", name: town.name, time: clockIn(timeZone, town.at, t.locale), icon: pathCalloutId(a.color), rank: town.size * 1000 + town.minutes },
        });
    }
    return { type: "FeatureCollection", features };
  }, [tracked, towns, selectedId, now, timeZone, t]);

  // A callout bubble per warning colour on the map, put back after a style reload.
  const colors = useMemo(() => [...new Set(tracked.map((a) => a.color))].join(), [tracked]);
  useEffect(() => {
    if (!mapAlive(map)) return;
    const wanted = colors ? colors.split(",") : [];
    const add = () => {
      for (const color of wanted) {
        if (!mapAlive(map) || map.hasImage(pathCalloutId(color))) continue;
        const img = pathCallout(color);
        if (img) map.addImage(pathCalloutId(color), img.data, img.options);
      }
    };
    add();
    const onMissing = (e: MapStyleImageMissingEvent) => {
      if (e.id.startsWith("path-callout-")) add();
    };
    map.on("styledata", add);
    map.on("styleimagemissing", onMissing);
    return () => {
      map.off("styledata", add);
      map.off("styleimagemissing", onMissing);
    };
  }, [map, colors]);

  useGeoJsonLayers(PATH_SRC, data, stormPathLayers, SLOTS.tracks);
  return null;
}
