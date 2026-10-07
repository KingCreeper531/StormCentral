"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useFeed } from "@/hooks/queries";
import { useAppStore } from "@/store/app-store";
import { GlassCard } from "../ui/glass-card";
import { EmptyState } from "../ui/misc";
import { PostCard } from "./post-card";

export function NearbyReports({ now }: { now: number }) {
  const loc = useAppStore((s) => s.location);
  const feed = useFeed({ sort: "nearby", lat: loc.lat.toFixed(2), lon: loc.lon.toFixed(2), radiusKm: "150" });
  const posts = (feed.data?.pages[0]?.posts ?? []).slice(0, 3);
  return (
    <GlassCard
      eyebrow="Spotter Network"
      title="Reports near you"
      action={
        <Link href="/community" className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          All reports <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      {posts.length ? (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} now={now} compact />
          ))}
        </div>
      ) : (
        <EmptyState title={feed.isLoading ? "Loading reports…" : "No reports within 150 km in a while"}>Seen something notable? Your report shows up here and on the radar.</EmptyState>
      )}
    </GlassCard>
  );
}
