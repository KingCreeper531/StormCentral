"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, EyeOff, Loader2, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getJson } from "@/lib/api/http";
import { badgeFor, CATEGORIES, DEVELOPER_BADGE, SEVERITY_LABELS, type CommentDto, type PostDto, isGenericPlace } from "@/lib/community";
import { useT } from "@/lib/i18n/use-t";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { describeCode } from "@/lib/weather/wmo";
import { useSession } from "@/hooks/queries";
import { useFormat } from "@/hooks/use-format";
import { useNow } from "@/hooks/use-now";
import { Button } from "../ui/button";
import { Avatar } from "../ui/misc";
import { ActionMenu, confirmBlock, errorText, ReportDialog, useBlock, type MenuAction } from "./moderation";

/** Chip recipe from DESIGN.md §5: hairline, 4 px corners, 11 px text. Colour only as a swatch. */
const CHIP = "inline-flex items-center gap-1.5 rounded-[4px] border border-line px-1.5 py-px text-[11px] font-medium text-ink-2";

/** Swatch per severity level; the two lowest levels stay neutral. */
const SEVERITY_SWATCH: (string | null)[] = [null, null, "var(--color-caution)", "var(--color-nogo)"];

/** Comment input — the DESIGN.md input recipe (16 px text on touch so iOS doesn't zoom). */
const INPUT =
  "h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent pointer-coarse:h-11 pointer-coarse:text-base";

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

function Sep() {
  return (
    <span aria-hidden>·</span>
  );
}

/**
 * One spotter report. Unframed on purpose: lists separate posts with
 * hairlines (`divide-y`), and the radar overlay/sheet embed it directly.
 * `compact` drops the photo, comments and actions (used in summaries).
 */
export function PostCard({ post, now: nowProp, compact = false }: { post: PostDto; now?: number; compact?: boolean }) {
  const t = useT();
  const tick = useNow(60_000);
  const now = nowProp ?? tick;
  const fmt = useFormat();
  const qc = useQueryClient();
  const { data: viewer } = useSession();
  const [showComments, setShowComments] = useState(false);
  const [reporting, setReporting] = useState(false);
  const blockUser = useBlock();
  const [verified, setVerified] = useState({ on: post.viewerVerified, n: post.verifications });
  const cat = CATEGORIES[post.category] ?? CATEGORIES.observation;
  const tier = badgeFor(post.author);
  const swatch = SEVERITY_SWATCH[post.severity] ?? null;
  const showHandle = post.author.displayName.toLowerCase() !== post.author.username.toLowerCase();

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

  const menu: MenuAction[] = [];
  if (viewer && !post.isOwn) {
    menu.push({ label: t("Report this report"), icon: "report", onSelect: () => setReporting(true) });
    menu.push({
      label: t("Block {name}", { name: post.author.displayName }),
      icon: "block",
      danger: true,
      onSelect: () => confirmBlock(post.author.displayName, t) && blockUser.mutate({ username: post.author.username, blocked: true }),
    });
    if (viewer.moderator)
      menu.push({
        label: t("Remove (moderator)"),
        icon: "remove",
        danger: true,
        onSelect: () => confirm(t("Remove this report for everyone?")) && remove.mutate(),
      });
  }

  const snap = post.conditions;
  const profile = `/u/${post.author.username}`;

  return (
    <article className={cn("min-w-0", compact ? "py-3 first:pt-0 last:pb-0" : "p-4 sm:px-5")} aria-label={t("{category} report by {name}", { category: t(cat.label), name: post.author.displayName })}>
      <header className="flex items-start gap-3">
        {/* The name link next to it carries the accessible name; this one is a pointer shortcut. */}
        <Link href={profile} tabIndex={-1} aria-hidden className="shrink-0">
          <Avatar name={post.author.displayName} hue={post.author.avatarHue} src={post.author.avatarUrl} size={32} />
        </Link>
        <div className="min-w-0 flex-1">
          {/* Always one line (name, then meta = two lines), so every header in a list has the same shape. */}
          <p className="flex min-w-0 items-baseline gap-2 text-sm leading-5 whitespace-nowrap">
            <Link href={profile} className="min-w-0 truncate font-semibold text-ink hover:underline">
              {post.author.displayName}
            </Link>
            {/* The display name defaults to the username; only show the handle when it adds something. */}
            {showHandle && <span className="hidden min-w-0 truncate text-[13px] text-ink-3 sm:inline">@{post.author.username}</span>}
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-ink-3">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: tier.color }} />
              {t(tier.name)}
            </span>
          </p>
          {/* One line: the place truncates first so time and distance stay readable. */}
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-ink-3">
            <time dateTime={new Date(post.createdAt).toISOString()} className="shrink-0 tabular">
              {timeAgo(post.createdAt, now, t)}
            </time>
            {!isGenericPlace(post.place) && (
              <>
                <Sep />
                <span className="min-w-0 truncate">{post.place}</span>
              </>
            )}
            {post.distanceKm != null && (
              <>
                <Sep />
                <span className="shrink-0 tabular">{t("{distance} away", { distance: fmt.distanceKm(post.distanceKm) })}</span>
              </>
            )}
          </p>
        </div>
      </header>

      {post.hidden && (
        <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-caution/40 bg-caution/10 px-3 py-2 text-xs text-ink-2">
          <EyeOff className="mt-px size-3.5 shrink-0" aria-hidden />
          {t("Hidden from others while moderators review reports about it. Only you can see it.")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={CHIP}>
          <span aria-hidden className="size-1.5 shrink-0 rounded-[1px]" style={{ background: cat.color }} />
          {t(cat.label)}
        </span>
        <span className={cn(CHIP, post.severity >= 3 && "text-ink")}>
          {swatch && <span aria-hidden className="size-1.5 shrink-0 rounded-[1px]" style={{ background: swatch }} />}
          {t(SEVERITY_LABELS[post.severity] ?? "")}
        </span>
      </div>

      <p className={cn("mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink", compact && "line-clamp-3")}>{post.body}</p>

      {post.image && !compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.image.url}
          alt={t("Photo: {category}", { category: t(cat.label) })}
          loading="lazy"
          decoding="async"
          className="mt-3 w-full rounded-[var(--radius-control)] border border-line bg-surface-2 object-cover"
          style={{ aspectRatio: post.image.width && post.image.height ? `${post.image.width} / ${post.image.height}` : "4 / 3", maxHeight: 440 }}
        />
      )}

      {snap && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span className="text-ink-3">{t("Model at report time")}</span>
          <span className="text-ink-2 tabular">
            {fmt.temp(snap.tempC)} · {t(describeCode(snap.code).label)}
            {snap.windMs != null && ` · ${t("wind {speed}", { speed: fmt.wind(snap.windMs) })}`}
            {snap.gustMs != null && ` (${t("gust {speed}", { speed: fmt.wind(snap.gustMs) })})`}
          </span>
        </p>
      )}

      {!compact && (
        <footer className="mt-3 -ml-2.5 flex flex-wrap items-center gap-1">
          {viewer && !post.isOwn ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => verify.mutate()}
              aria-pressed={verified.on}
              aria-label={
                verified.on
                  ? t("Verified · {n} (confirmed by you)", { n: verified.n })
                  : t.plural(verified.n, "I can confirm · {n} confirmation", "I can confirm · {n} confirmations")
              }
              className={cn(verified.on && "bg-surface-3 text-ink hover:bg-surface-3")}
            >
              <BadgeCheck className={cn("size-4", verified.on && "text-go")} aria-hidden />
              {verified.on ? t("Confirmed") : t("Confirm")}
              <span className={cn("tabular", verified.on ? "text-ink-2" : "text-ink-3")}>{verified.n}</span>
            </Button>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 px-2.5 text-[13px] text-ink-3 pointer-coarse:min-h-11">
              <BadgeCheck className="size-4" aria-hidden />
              <span className="tabular">{t.plural(verified.n, "{n} confirmation", "{n} confirmations")}</span>
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowComments((s) => !s)}
            aria-expanded={showComments}
            aria-label={t.plural(post.comments, "{n} comment", "{n} comments")}
            className={cn(showComments && "bg-surface-2 text-ink")}
          >
            <MessageSquare className="size-4" aria-hidden />
            <span className="tabular">{post.comments}</span>
          </Button>
          {post.isOwn && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => confirm(t("Delete this report?")) && remove.mutate()}
              disabled={remove.isPending}
              className="ml-auto"
            >
              {remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
              {t("Delete")}
            </Button>
          )}
          {menu.length > 0 && (
            <div className="ml-auto">
              <ActionMenu label={t("More actions")} actions={menu} />
            </div>
          )}
        </footer>
      )}
      {(blockUser.error || remove.error) && (
        <p role="alert" className="mt-2 text-xs text-ink-2">
          {errorText(t, ((blockUser.error ?? remove.error) as Error).message)}
        </p>
      )}
      {showComments && <Comments postId={post.id} now={now} />}
      {reporting && <ReportDialog type="post" id={post.id} onClose={() => setReporting(false)} />}
    </article>
  );
}

function Comments({ postId, now }: { postId: string; now: number }) {
  const t = useT();
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
  const comments = list.data ?? [];
  const [reporting, setReporting] = useState<string | null>(null);
  const blockUser = useBlock();
  const removeComment = useMutation({
    mutationFn: (id: string) => send(`/api/comments/${id}`, "DELETE"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["comments", postId] });
      void qc.invalidateQueries({ queryKey: ["posts"] });
    },
  });
  const commentMenu = (c: CommentDto): MenuAction[] => {
    if (!viewer) return [];
    if (c.isOwn)
      return [{ label: t("Delete comment"), icon: "delete", danger: true, onSelect: () => confirm(t("Delete this comment?")) && removeComment.mutate(c.id) }];
    const items: MenuAction[] = [
      { label: t("Report comment"), icon: "report", onSelect: () => setReporting(c.id) },
      {
        label: t("Block {name}", { name: c.author.displayName }),
        icon: "block",
        danger: true,
        onSelect: () => confirmBlock(c.author.displayName, t) && blockUser.mutate({ username: c.author.username, blocked: true }),
      },
    ];
    if (viewer.moderator)
      items.push({
        label: t("Remove (moderator)"),
        icon: "remove",
        danger: true,
        onSelect: () => confirm(t("Remove this comment for everyone?")) && removeComment.mutate(c.id),
      });
    return items;
  };
  // "{signIn} to comment." with the link in place of {signIn} (fill leaves an unknown placeholder as it is).
  const [signInBefore, signInAfter = ""] = t("{signIn} to comment.").split("{signIn}");
  return (
    <div className="mt-2 border-t border-line pt-1">
      {list.isLoading && <p className="py-2.5 text-xs text-ink-3">{t("Loading comments…")}</p>}
      {list.error && <p className="py-2.5 text-xs text-ink-3">{t("Couldn't load comments.")}</p>}
      {comments.length > 0 && (
        <ul className="divide-y divide-line" aria-label={t("Comments")}>
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5 py-2.5">
              <Avatar name={c.author.displayName} hue={c.author.avatarHue} src={c.author.avatarUrl} size={24} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline gap-2 text-[13px] leading-5">
                  <span className="truncate font-semibold text-ink">{c.author.displayName}</span>
                  {c.author.developer && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-3">
                      <span aria-hidden className="size-1.5 rounded-full" style={{ background: DEVELOPER_BADGE.color }} />
                      {t(DEVELOPER_BADGE.name)}
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-ink-3 tabular">{timeAgo(c.createdAt, now, t)}</span>
                </p>
                <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">{c.body}</p>
                {c.hidden && <p className="mt-0.5 text-xs text-ink-3">{t("Hidden from others while moderators review it.")}</p>}
              </div>
              <div className="-mt-1 -mr-2 shrink-0">
                <ActionMenu label={t("Comment actions")} actions={commentMenu(c)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {viewer ? (
        <form
          className="flex gap-2 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            placeholder={t("Add a comment")}
            aria-label={t("Add a comment")}
            enterKeyHint="send"
            className={INPUT}
          />
          <Button type="submit" variant="primary" disabled={add.isPending || !body.trim()}>
            {t("Post")}
          </Button>
        </form>
      ) : (
        <p className="pt-2 text-xs text-ink-3">
          {signInBefore}
          <Link href="/login" className="font-medium text-accent hover:underline">
            {t("Sign in")}
          </Link>
          {signInAfter}
        </p>
      )}
      {(add.error || blockUser.error || removeComment.error) && (
        <p role="alert" className="mt-2 text-xs text-ink-2">
          {errorText(t, ((add.error ?? blockUser.error ?? removeComment.error) as Error).message)}
        </p>
      )}
      {reporting && <ReportDialog type="comment" id={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
}
