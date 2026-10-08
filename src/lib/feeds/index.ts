import { alertsFeed } from "./alerts";
import { gnssFeed } from "./gnss";
import { outlookFeed } from "./outlook";
import { radarProductsFeed, radarScansFeed } from "./radar";
import { riversFeed } from "./rivers";
import { spaceWeatherFeed } from "./space-weather";
import { stormCellsFeed } from "./storm-cells";
import { stormReportsFeed } from "./storm-reports";
import { tropicalFeed } from "./tropical";
import type { Feed } from "./types";

/** Every weather feed by route path. Route handlers import their own feed directly. */
export const FEEDS: ReadonlyMap<string, Feed> = new Map(
  [
    alertsFeed,
    outlookFeed,
    spaceWeatherFeed,
    riversFeed,
    gnssFeed,
    radarScansFeed,
    radarProductsFeed,
    stormReportsFeed,
    stormCellsFeed,
    tropicalFeed,
  ].map((f) => [f.path, f as Feed]),
);
