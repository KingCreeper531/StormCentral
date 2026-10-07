"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useFeed } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { useAppStore } from "@/store/app-store";
import { EmptyState, ErrorNote, Skeleton } from "../ui/misc";
import { Segmented } from "../ui/segmented";
import { WeatherIcon } from "../ui/weather-icon";
import { PostCard } from "./post-card";

type Tab = "latest" | "nearby" | "top";

export function Feed({ user }: { user?: string }) {
  const loc = useAppStore((s) => s.location);
  const hydrated = useAppStore((s) => s.hydrated);
  const [tab, setTab] = useState<Tab>("latest");
  const now = useNow(60_000);
  const params: Record<string, string> = user
    ? { user }
    : tab === "nearby"
      ? { sort: "nearby", lat: loc.lat.toFixed(3), lon: loc.lon.toFixed(3), radiusKm: "200" }
      : tab === "top"
        ? { sort: "top", hours: "24" }
        : { sort: "latest" };
  const feed = useFeed(params);
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="space-y-4">
      {!user && (
        <Segmented
          ariaLabel="Feed"
          value={tab}
          onChange={setTab}
          className="glass"
          options={[
            { value: "latest", label: "Latest" },
            { value: "nearby", label: hydrated ? `Near ${loc.name.split(",")[0]}` : "Nearby" },
            { value: "top", label: "Top 24 h" },
          ]}
        />
      )}
      {feed.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-44" />
          <Skeleton className="h-64" />
        </div>
      )}
      {feed.error && <ErrorNote error={feed.error} what="reports" />}
      {!feed.isLoading && !posts.length && !feed.error && (
        <EmptyState icon={<WeatherIcon name="cloudy-2-day" size={64} />} title="No reports yet">
          Be the first to share what the sky is doing — tap <span className="text-ink">Report weather</span>.
        </EmptyState>
      )}
      {posts.map((p) => (
        <PostCard key={p.id} post={p} now={now} />
      ))}
      {feed.hasNextPage && (
        <button type="button" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className="glass mx-auto flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium">
          {feed.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />} Load more
        </button>
      )}
    </div>
  );
}
