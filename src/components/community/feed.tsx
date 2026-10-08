"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useFeed } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import { useAppStore } from "@/store/app-store";
import { Button } from "../ui/button";
import { EmptyState, ErrorNote, Skeleton } from "../ui/misc";
import { Tabs } from "../ui/tabs";
import { NEARBY_RADIUS_KM } from "./constants";
import { PostCard } from "./post-card";

type Tab = "latest" | "nearby" | "top";

const EMPTY: Record<Tab, { title: string; body: (radius: string) => string }> = {
  latest: { title: "No reports yet", body: () => "Reports from spotters appear here as they are posted." },
  nearby: { title: "No reports nearby", body: (radius) => `Nothing has been reported within ${radius} of this location.` },
  top: { title: "No reports in the last 24 hours", body: () => "Confirmed reports from the past day are ranked here." },
};

function PostSkeleton() {
  return (
    <div className="flex gap-3 p-4 sm:px-5" aria-hidden>
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2.5 pt-1">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

/**
 * Report feed: one surface with underline tabs on top and posts separated by
 * hairlines. With `user`, it lists that spotter's reports and has no tabs.
 */
export function Feed({ user }: { user?: string }) {
  const loc = useAppStore((s) => s.location);
  const hydrated = useAppStore((s) => s.hydrated);
  const setComposerOpen = useAppStore((s) => s.setComposerOpen);
  const [tab, setTab] = useState<Tab>("latest");
  const now = useNow(60_000);
  const fmt = useFormat();
  const radius = fmt.distanceKm(NEARBY_RADIUS_KM);
  const params: Record<string, string> = user
    ? { user }
    : tab === "nearby"
      ? { sort: "nearby", lat: loc.lat.toFixed(3), lon: loc.lon.toFixed(3), radiusKm: String(NEARBY_RADIUS_KM) }
      : tab === "top"
        ? { sort: "top", hours: "24" }
        : { sort: "latest" };
  const feed = useFeed(params);
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];
  const empty = user ? { title: "No reports yet", body: "This spotter hasn't posted any reports." } : { title: EMPTY[tab].title, body: EMPTY[tab].body(radius) };

  return (
    <section className="surface min-w-0 overflow-hidden" aria-label={user ? "Reports" : "Spotter reports"}>
      {!user && (
        <div className="border-b border-line px-4 sm:px-5">
          <Tabs<Tab>
            ariaLabel="Feed"
            value={tab}
            onChange={setTab}
            className="gap-5"
            items={[
              { value: "latest", label: "Latest" },
              { value: "nearby", label: "Nearby" },
              { value: "top", label: "Top 24 h" },
            ]}
          />
        </div>
      )}
      {!user && tab === "nearby" && hydrated && (
        <p className="truncate border-b border-line px-4 py-2 text-xs text-ink-3 sm:px-5">
          Within {radius} of {loc.name}
        </p>
      )}

      <div role={user ? undefined : "tabpanel"} aria-label={user ? undefined : "Reports"}>
        {feed.isLoading && (
          <div className="divide-y divide-line">
            <PostSkeleton />
            <PostSkeleton />
            <PostSkeleton />
          </div>
        )}
        {feed.error && (
          <div className="p-4 sm:px-5">
            <ErrorNote error={feed.error} what="reports" />
          </div>
        )}
        {!feed.isLoading && !posts.length && !feed.error && (
          <EmptyState title={empty.title}>
            <p>{empty.body}</p>
            {!user && (
              <Button size="sm" className="mt-3" onClick={() => setComposerOpen(true)}>
                Report weather
              </Button>
            )}
          </EmptyState>
        )}
        {posts.length > 0 && (
          <div className="divide-y divide-line">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} now={now} />
            ))}
          </div>
        )}
      </div>

      {feed.hasNextPage && (
        <div className="flex justify-center border-t border-line p-3">
          <Button onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Load more
          </Button>
        </div>
      )}
    </section>
  );
}
