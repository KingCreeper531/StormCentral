"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useFeed } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { EmptyState } from "../ui/misc";
import { Panel } from "../ui/panel";
import { NEARBY_RADIUS_KM } from "./constants";
import { PostCard } from "./post-card";

/** Track count follows the number of posts so one or two reports still fill the row on desktop. */
const LG_COLS = ["", "", "lg:grid-cols-2", "lg:grid-cols-3"];

export function NearbyReports({ now }: { now: number }) {
  const loc = useAppStore((s) => s.location);
  const radius = useFormat().distanceKm(NEARBY_RADIUS_KM);
  const feed = useFeed({ sort: "nearby", lat: loc.lat.toFixed(2), lon: loc.lon.toFixed(2), radiusKm: String(NEARBY_RADIUS_KM) });
  const posts = (feed.data?.pages[0]?.posts ?? []).slice(0, 3);
  return (
    <Panel
      title="Reports near you"
      subtitle={`Spotter network · within ${radius}`}
      action={
        <Link
          href="/community"
          className="-my-1 inline-flex h-8 items-center gap-1 text-[13px] font-medium text-accent hover:underline pointer-coarse:min-h-11"
        >
          All reports <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      {posts.length ? (
        <ul className={cn("grid grid-cols-1 divide-y divide-line lg:divide-x lg:divide-y-0", LG_COLS[posts.length])}>
          {posts.map((p) => (
            <li key={p.id} className="min-w-0 py-3 first:pt-0 last:pb-0 lg:px-5 lg:py-0 lg:first:pl-0 lg:last:pr-0">
              <PostCard post={p} now={now} compact />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={feed.isLoading ? "Loading reports…" : `No reports within ${radius} recently`}>
          Reports posted near this location appear here and on the radar map.
        </EmptyState>
      )}
    </Panel>
  );
}
