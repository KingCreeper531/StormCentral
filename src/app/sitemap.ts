import type { MetadataRoute } from "next";
import { PUBLIC_APP_URL } from "@/lib/platform";

/** The app's public pages (spotter profiles are reached from reports, not listed). Not in the Android bundle (only .tsx). */
const SITEMAP_PATHS = ["/", "/alerts", "/community", "/community/scorecard", "/privacy"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_PATHS.map((path) => ({
    url: `${PUBLIC_APP_URL}${path}`,
    changeFrequency: path === "/privacy" ? "monthly" : "daily",
    priority: path === "/" ? 1 : 0.6,
  }));
}
