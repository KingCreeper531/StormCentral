/**
 * Sending spotter reports on to NOAA's mPING (Meteorological Phenomena
 * Identification Near the Ground), the crowd-report database NWS forecasters
 * and researchers use. mPING takes a report type picked from its own menu, a
 * time and a point; each option here says which menu entry it is by matching
 * mPING's category and description names, so the server looks the numeric ids
 * up from mPING itself (lib/server/mping) instead of hard-coding them.
 */
import type { Category } from "./community";

export interface MpingOption {
  /** Sent with the report form and stored nowhere else. */
  key: string;
  /** Shown in the composer (translated). */
  label: string;
  /** mPING's category name. */
  category: RegExp;
  /** mPING's description name within it. */
  description: RegExp;
}

const hail = (key: string, label: string, description: RegExp): MpingOption => ({ key: `hail-${key}`, label, category: /hail/i, description });
const wind = (key: string, label: string, description: RegExp): MpingOption => ({ key: `wind-${key}`, label, category: /wind/i, description });
const flood = (key: string, label: string, description: RegExp): MpingOption => ({ key: `flood-${key}`, label, category: /flood/i, description });

/** The categories mPING takes, and what it needs to know about each. Lightning, sky photos and plain observations aren't mPING reports. */
export const MPING_OPTIONS: Partial<Record<Category, readonly MpingOption[]>> = {
  hail: [
    hail("pea", "Pea (¼ in)", /\bpea\b/i),
    hail("half", "Half inch (½ in)", /half[- ]?inch/i),
    hail("dime", "Dime (¾ in)", /\bdime\b/i),
    hail("quarter", "Quarter (1 in)", /\bquarter\b/i),
    hail("half-dollar", "Half dollar (1¼ in)", /half[- ]?dollar/i),
    hail("ping-pong", "Ping pong ball (1½ in)", /ping[- ]?pong/i),
    hail("golf", "Golf ball (1¾ in)", /golf/i),
    hail("egg", "Hen egg (2 in)", /\begg\b(?!\+)/i),
    hail("tennis", "Tennis ball (2½ in)", /tennis/i),
    hail("baseball", "Baseball (2¾ in)", /baseball(?!\+)/i),
    hail("tea-cup", "Tea cup (3 in)", /tea ?cup/i),
    hail("grapefruit", "Grapefruit (4 in)", /grapefruit/i),
    hail("softball", "Softball (4½ in or more)", /softball(?!\+)/i),
  ],
  wind: [
    wind("twigs", "Twigs broken, lawn furniture moved", /twig|furniture|trash/i),
    wind("limbs", "1-inch branches broken, shingles off", /1[- ]?inch|shingle/i),
    wind("big-limbs", "3-inch branches broken, power poles down", /3[- ]?inch|power pole/i),
    wind("trees", "Large trees uprooted, roof blown off", /uproot|roof/i),
    wind("destroyed", "Buildings destroyed", /destroy/i),
  ],
  tornado: [
    { key: "tornado", label: "Tornado on the ground", category: /tornado/i, description: /tornado|on ground/i },
    { key: "waterspout", label: "Waterspout", category: /tornado/i, description: /water ?spout/i },
  ],
  flooding: [
    flood("creek", "Creek or river over its banks, yard or basement flooding", /river|creek|basement/i),
    flood("street", "Street flooded or closed, cars stranded", /street|road|vehicle/i),
    flood("homes", "Homes or buildings flooded", /filled|flooded/i),
    flood("swept", "Homes, buildings or cars swept away", /swept/i),
  ],
  rain: [
    { key: "rain", label: "Rain", category: /^rain$/i, description: /^rain$/i },
    { key: "drizzle", label: "Drizzle", category: /^drizzle$/i, description: /^drizzle$/i },
  ],
  snow: [
    { key: "snow", label: "Snow", category: /^snow$/i, description: /^snow$/i },
    { key: "freezing-rain", label: "Freezing rain", category: /^freezing rain$/i, description: /^freezing rain$/i },
    { key: "sleet", label: "Sleet (ice pellets)", category: /ice pellets|sleet/i, description: /ice pellets|sleet/i },
    { key: "rain-snow", label: "Rain and snow mixed", category: /rain and snow/i, description: /rain and snow/i },
  ],
  fog: [
    { key: "fog", label: "Dense fog", category: /visibility/i, description: /fog/i },
    { key: "smoke", label: "Smoke", category: /visibility/i, description: /smoke/i },
    { key: "dust", label: "Blowing dust or sand", category: /visibility/i, description: /dust|sand/i },
    { key: "blowing-snow", label: "Blowing snow", category: /visibility/i, description: /blowing snow/i },
  ],
};

/** The option `key` names for a report of `category`, if mPING takes it. */
export const mpingOption = (category: string, key: string | null | undefined): MpingOption | null =>
  (key && MPING_OPTIONS[category as Category]?.find((o) => o.key === key)) || null;
