"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff, Loader2, ShieldX, UserX } from "lucide-react";
import Link from "next/link";
import { getJson } from "@/lib/api/http";
import { FLAG_REASONS, suspensionText, type ModerationAction, type QueueItemDto } from "@/lib/community";
import { timeAgo } from "@/lib/time";
import { useNow } from "@/hooks/use-now";
import { Button } from "../ui/button";
import { EmptyState, ErrorNote, Skeleton } from "../ui/misc";
import { Avatar } from "../ui/misc";
import { sendJson } from "./moderation";

const KIND = { post: "Report", comment: "Comment", user: "Account" } as const;
const SUSPEND = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 0, label: "Permanently" },
] as const;

function QueueItem({ item, now }: { item: QueueItemDto; now: number }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (a: ModerationAction) => sendJson("/api/moderation", "POST", a),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["moderation"] }), qc.invalidateQueries({ queryKey: ["posts"] })]),
  });
  const a = item.author!;
  const reasons = Object.entries(
    item.flags.reduce<Record<string, number>>((acc, f) => ((acc[f.reason] = (acc[f.reason] ?? 0) + 1), acc), {}),
  ).sort((x, y) => y[1] - x[1]);
  const busy = act.isPending;

  return (
    <article className="space-y-3 p-4 sm:px-5" aria-label={`${KIND[item.type]} by ${a.displayName}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <span className="rounded-[4px] border border-line px-1.5 py-px text-[11px] font-medium text-ink-2">{KIND[item.type]}</span>
        <span>
          {item.flags.length} report{item.flags.length === 1 ? "" : "s"} · first {timeAgo(item.firstFlaggedAt, now)}
        </span>
        {item.hidden && (
          <span className="inline-flex items-center gap-1 text-ink-2">
            <EyeOff className="size-3.5" aria-hidden />
            Hidden until reviewed
          </span>
        )}
      </header>

      <div className="flex items-start gap-3">
        <Avatar name={a.displayName} hue={a.avatarHue} src={a.avatarUrl} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <Link href={`/u/${a.username}`} className="font-semibold text-ink hover:underline">
              {a.displayName}
            </Link>{" "}
            <span className="text-ink-3">@{a.username}</span>
            {item.createdAt != null && item.type !== "user" && <span className="text-xs text-ink-3"> · posted {timeAgo(item.createdAt, now)}</span>}
          </p>
          {a.suspendedUntil != null && <p className="text-xs text-nogo">{suspensionText(a.suspendedUntil)}</p>}
          {item.body ? (
            <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">{item.body}</p>
          ) : (
            item.type === "user" && <p className="mt-1 text-sm text-ink-3">No bio.</p>
          )}
          {item.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt="Attached image" loading="lazy" className="mt-2 max-h-72 rounded-[var(--radius-control)] border border-line object-contain" />
          )}
        </div>
      </div>

      <div className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-[13px]">
        <p className="text-ink-2">{reasons.map(([r, n]) => `${FLAG_REASONS[r as keyof typeof FLAG_REASONS]}${n > 1 ? ` (${n})` : ""}`).join(" · ")}</p>
        {item.flags.some((f) => f.details) && (
          <ul className="mt-1.5 space-y-1">
            {item.flags
              .filter((f) => f.details)
              .map((f, i) => (
                <li key={i} className="text-xs text-ink-3">
                  <span className="text-ink-2">@{f.reporter}:</span> {f.details}
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => act.mutate({ action: "keep", type: item.type, id: item.id })} disabled={busy}>
          <Check className="size-4" aria-hidden />
          {item.type === "user" ? "Dismiss" : "Keep"}
        </Button>
        {item.type !== "user" && (
          <Button
            size="sm"
            variant="danger"
            onClick={() => confirm(`Delete this ${item.type === "post" ? "report" : "comment"} for everyone?`) && act.mutate({ action: "remove", type: item.type as "post" | "comment", id: item.id })}
            disabled={busy}
          >
            <ShieldX className="size-4" aria-hidden />
            Remove
          </Button>
        )}
        {a.suspendedUntil != null ? (
          <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: "unsuspend", username: a.username })} disabled={busy}>
            Lift suspension
          </Button>
        ) : (
          <label className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
            <UserX className="size-4 text-ink-3" aria-hidden />
            <span className="sr-only sm:not-sr-only">Suspend</span>
            <select
              aria-label={`Suspend ${a.displayName}`}
              value=""
              disabled={busy}
              onChange={(e) => {
                const days = Number(e.target.value) as 1 | 7 | 30 | 0;
                const label = SUSPEND.find((s) => s.days === days)?.label.toLowerCase();
                if (confirm(`Suspend ${a.displayName} ${days === 0 ? "permanently" : `for ${label}`}? Their reports and comments are hidden while suspended.`))
                  act.mutate({ action: "suspend", username: a.username, days });
              }}
              className="h-8 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 text-[13px] text-ink pointer-coarse:h-11"
            >
              <option value="" disabled>
                Choose…
              </option>
              {SUSPEND.map((s) => (
                <option key={s.days} value={s.days}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {busy && <Loader2 className="size-4 animate-spin text-ink-3" aria-hidden />}
      </div>
      {act.error && (
        <p role="alert" className="text-xs text-ink-2">
          {(act.error as Error).message}
        </p>
      )}
    </article>
  );
}

/** Everything with open reports, oldest first, with the actions a moderator can take. */
export function ModerationQueue() {
  const now = useNow(60_000);
  const queue = useQuery({
    queryKey: ["moderation"],
    queryFn: ({ signal }) => getJson<{ items: QueueItemDto[] }>("/api/moderation", { signal }).then((r) => r.items),
    refetchInterval: 60_000,
  });
  if (queue.isLoading)
    return (
      <div className="surface space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  if (queue.error) return <ErrorNote error={queue.error} what="the moderation queue" />;
  const items = queue.data ?? [];
  if (!items.length)
    return (
      <div className="surface">
        <EmptyState title="Nothing to review">
          <p>Reported content and accounts show up here.</p>
        </EmptyState>
      </div>
    );
  return (
    <section className="surface divide-y divide-line overflow-hidden" aria-label="Moderation queue">
      {items.map((item) => (
        <QueueItem key={`${item.type}:${item.id}`} item={item} now={now} />
      ))}
    </section>
  );
}
