"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, MapPin, MessageCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getJson } from "@/lib/api/http";
import { CATEGORIES, SEVERITY_LABELS, tierFor, type CommentDto, type PostDto } from "@/lib/community";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { describeCode } from "@/lib/weather/wmo";
import { useSession } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import { Avatar } from "../ui/misc";
import { WeatherIcon } from "../ui/weather-icon";

const SEVERITY_CLS = [
  "bg-white/10 text-ink-2",
  "bg-sky-400/15 text-sky-200",
  "bg-amber-400/15 text-amber-200",
  "bg-red-500/20 text-red-200",
];

async function send(url: string, method: "POST" | "DELETE", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data;
}

export function PostCard({ post, now: nowProp, compact = false }: { post: PostDto; now?: number; compact?: boolean }) {
  const tick = useNow(60_000);
  const now = nowProp ?? tick;
  const fmt = useFormat();
  const qc = useQueryClient();
  const { data: viewer } = useSession();
  const [showComments, setShowComments] = useState(false);
  const [verified, setVerified] = useState({ on: post.viewerVerified, n: post.verifications });
  const cat = CATEGORIES[post.category] ?? CATEGORIES.observation;
  const tier = tierFor(post.author.reputation);

  const verify = useMutation({
    mutationFn: () => send(`/api/posts/${post.id}/verify`, "POST") as Promise<{ verified: boolean; count: number }>,
    onMutate: () => setVerified((v) => ({ on: !v.on, n: v.n + (v.on ? -1 : 1) })),
    onSuccess: (r) => setVerified({ on: r.verified, n: r.count }),
    onError: () => setVerified({ on: post.viewerVerified, n: post.verifications }),
  });
  const remove = useMutation({
    mutationFn: () => send(`/api/posts/${post.id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["posts"] }),
  });

  const snap = post.conditions;

  return (
    <article className="glass rounded-[var(--radius-pane)] p-4" aria-label={`${cat.label} report by ${post.author.displayName}`}>
      <header className="flex items-start gap-3">
        <Link href={`/u/${post.author.username}`} className="shrink-0">
          <Avatar name={post.author.displayName} hue={post.author.avatarHue} size={38} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
            <Link href={`/u/${post.author.username}`} className="font-semibold text-ink hover:underline">
              {post.author.displayName}
            </Link>
            <span className="text-ink-3">@{post.author.username}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] font-semibold text-ink-2">
              <span className="size-1.5 rounded-full" style={{ background: tier.color }} />
              {tier.name}
            </span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
            <time dateTime={new Date(post.createdAt).toISOString()}>{timeAgo(post.createdAt, now)}</time>
            {post.place && (
              <>
                · <MapPin className="size-3" aria-hidden /> {post.place}
              </>
            )}
            {post.distanceKm != null && <>· {fmt.distanceKm(post.distanceKm)} away</>}
          </p>
        </div>
        <span className="flex items-center gap-1.5">
          <WeatherIcon name={cat.icon} size={30} animated={false} />
        </span>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-white/10" style={{ background: `${cat.color}22`, color: "var(--color-ink)" }}>
          {cat.label}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", SEVERITY_CLS[post.severity])}>{SEVERITY_LABELS[post.severity]}</span>
      </div>

      <p className={cn("mt-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink", compact && "line-clamp-3")}>{post.body}</p>

      {post.image && !compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.image.url}
          alt={`Photo: ${cat.label}`}
          loading="lazy"
          decoding="async"
          className="mt-3 w-full rounded-2xl bg-white/5 object-cover"
          style={{ aspectRatio: post.image.width && post.image.height ? `${post.image.width} / ${post.image.height}` : "4 / 3", maxHeight: 520 }}
        />
      )}

      {snap && (
        <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-ink-3">
          <span className="font-medium text-ink-2">Model at report time:</span> {fmt.temp(snap.tempC)} · {describeCode(snap.code).label}
          {snap.windMs != null && ` · wind ${fmt.wind(snap.windMs)}`}
          {snap.gustMs != null && ` (gust ${fmt.wind(snap.gustMs)})`}
        </p>
      )}

      {!compact && (
        <footer className="mt-3 flex items-center gap-1 border-t border-line pt-2.5">
          {viewer && !post.isOwn ? (
            <button
              type="button"
              onClick={() => verify.mutate()}
              aria-pressed={verified.on}
              className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors", verified.on ? "bg-go/15 text-go" : "text-ink-2 hover:bg-white/10")}
            >
              <BadgeCheck className="size-4" /> {verified.on ? "Verified" : "I can confirm"} · {verified.n}
            </button>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink-3">
              <BadgeCheck className="size-4" /> {verified.n} confirmation{verified.n === 1 ? "" : "s"}
            </span>
          )}
          <button type="button" onClick={() => setShowComments((s) => !s)} aria-expanded={showComments} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-white/10">
            <MessageCircle className="size-4" /> {post.comments}
          </button>
          {post.isOwn && (
            <button
              type="button"
              onClick={() => confirm("Delete this report?") && remove.mutate()}
              className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-ink-3 hover:bg-nogo/15 hover:text-nogo"
            >
              <Trash2 className="size-4" /> Delete
            </button>
          )}
        </footer>
      )}
      {showComments && <Comments postId={post.id} now={now} />}
    </article>
  );
}

function Comments({ postId, now }: { postId: string; now: number }) {
  const qc = useQueryClient();
  const { data: viewer } = useSession();
  const [body, setBody] = useState("");
  const list = useQuery({
    queryKey: ["comments", postId],
    queryFn: ({ signal }) => getJson<{ comments: CommentDto[] }>(`/api/posts/${postId}/comments`, { signal }).then((r) => r.comments),
  });
  const add = useMutation({
    mutationFn: () => send(`/api/posts/${postId}/comments`, "POST", { body }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["comments", postId] });
      void qc.invalidateQueries({ queryKey: ["posts"] });
    },
  });
  return (
    <div className="mt-3 space-y-3">
      {list.data?.map((c) => (
        <div key={c.id} className="flex gap-2.5">
          <Avatar name={c.author.displayName} hue={c.author.avatarHue} size={26} />
          <div className="min-w-0 rounded-2xl bg-white/[0.05] px-3 py-2">
            <p className="text-xs">
              <span className="font-semibold text-ink">{c.author.displayName}</span> <span className="text-ink-3">· {timeAgo(c.createdAt, now)}</span>
            </p>
            <p className="text-sm break-words whitespace-pre-wrap text-ink-2">{c.body}</p>
          </div>
        </div>
      ))}
      {viewer ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="min-w-0 flex-1 rounded-full bg-white/[0.06] px-4 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-accent"
          />
          <button disabled={add.isPending || !body.trim()} className="rounded-full bg-white px-4 text-xs font-semibold text-black disabled:opacity-40">
            Post
          </button>
        </form>
      ) : (
        <p className="text-xs text-ink-3">
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>{" "}
          to join the conversation.
        </p>
      )}
      {add.error && <p className="text-xs text-nogo">{(add.error as Error).message}</p>}
    </div>
  );
}
