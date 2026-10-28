import { alertsFeed } from "./alerts";
import { buoysFeed } from "./buoys";
import { climateFeed } from "./climate";
import { floodGaugesFeed } from "./flood-gauges";
import { forecasterNotesFeed } from "./forecaster-notes";
import { gnssFeed } from "./gnss";
import { hazardsFeed } from "./hazards";
import { outlookFeed } from "./outlook";
import { intlTimesFeed, noaaTimesFeed, radarProductsFeed, radarScansFeed } from "./radar";
import { riversFeed } from "./rivers";
import { spaceWeatherFeed } from "./space-weather";
import { stormCellsFeed } from "./storm-cells";
import { stormReportsFeed } from "./storm-reports";
import { tropicalFeed } from "./tropical";
import type { Feed } from "./types";
import { webcamsFeed } from "./webcams";
import { wildfiresFeed } from "./wildfires";

/** Every weather feed by route path. Route handlers import their own feed directly. */
export const FEEDS: ReadonlyMap<string, Feed> = new Map(
  [
    alertsFeed,
    hazardsFeed,
    outlookFeed,
    spaceWeatherFeed,
    riversFeed,
    gnssFeed,
    radarScansFeed,
    radarProductsFeed,
    noaaTimesFeed,
    intlTimesFeed,
    stormReportsFeed,
    stormCellsFeed,
    tropicalFeed,
    floodGaugesFeed,
    forecasterNotesFeed,
    climateFeed,
    wildfiresFeed,
    webcamsFeed,
    buoysFeed,
  ].map((f) => [f.path, f as Feed]),
);
