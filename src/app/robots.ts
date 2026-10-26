import type { MetadataRoute } from "next";
import { PUBLIC_APP_URL } from "@/lib/platform";

/** Crawlers get the public pages; the API, account tools and pop-out windows stay out. Not in the Android bundle (only .tsx). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/moderation", "/pro-window", "/broadcast", "/forgot-password", "/reset-password"],
    },
    sitemap: `${PUBLIC_APP_URL}/sitemap.xml`,
  };
}
