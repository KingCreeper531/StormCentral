/**
 * Lightning: NOAA nowCOAST lightning strike density (ground-based network,
 * 15-minute windows, ~8 km grid), served by nowCOAST's GeoServer as WMS.
 * NOAA notes it is not meant for lightning-safety decisions: it is coarse and
 * a few minutes behind.
 */
export const LIGHTNING_WMS = "https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows";
export const LIGHTNING_ATTRIBUTION = "Lightning: NOAA nowCOAST";
/** nowCOAST updates the density grid every 15 minutes; refresh a little more often. */
export const LIGHTNING_REFRESH_MS = 5 * 60_000;

/** WMS GetMap template for MapLibre (`{bbox-epsg-3857}` is filled per tile). `slot` busts caches between updates. */
export function lightningTileUrl(slot: number): string {
  const q = [
    "service=WMS",
    "version=1.3.0",
    "request=GetMap",
    "layers=lightning_detection",
    "styles=",
    "format=image/png",
    "transparent=true",
    "crs=EPSG:3857",
    "width=256",
    "height=256",
    "bbox={bbox-epsg-3857}",
    `_=${slot}`,
  ].join("&");
  return `${LIGHTNING_WMS}?${q}`;
}
