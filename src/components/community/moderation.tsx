"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Flag, Loader2, MoreHorizontal, ShieldX, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { FLAG_REASON_IDS, FLAG_REASONS, type FlagReason, type FlagTarget } from "@/lib/community";
import type { Translator } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "../ui/button";

/** JSON request that throws the server's error message. */
export async function sendJson<T = unknown>(url: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * An error message from our API (or the fallbacks above) in the viewer's
 * language. The two messages with a value in them are matched by pattern.
 */
export function errorText(t: Translator, message: string) {
  const failed = /^Request failed \((\d+)\)$/.exec(message);
  if (failed) return t("Request failed ({status})", { status: failed[1]! });
  const until = /^This account is suspended until (.+)\.$/.exec(message);
  if (until) return t("This account is suspended until {date}.", { date: until[1]! });
  return t(message);
}

/** Everything a block or unblock changes: feeds, comments, the blocked list, profiles. */
function useRefreshCommunity() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["posts"] }),
      qc.invalidateQueries({ queryKey: ["comments"] }),
      qc.invalidateQueries({ queryKey: ["blocks"] }),
    ]);
}

/** Block or unblock an account by username. */
export function useBlock() {
  const refresh = useRefreshCommunity();
  return useMutation({
    mutationFn: ({ username, blocked }: { username: string; blocked: boolean }) => sendJson("/api/blocks", blocked ? "POST" : "DELETE", { username }),
    onSuccess: () => refresh(),
  });
}

/** Asks first, then blocks. */
export function confirmBlock(displayName: string, t: Translator) {
  return confirm(
    t(
      "Block {name}?\n\nYou won't see each other's reports or comments, and neither of you can comment on or confirm the other's reports. You can unblock them in Settings → Account.",
      { name: displayName },
    ),
  );
}

const TITLE: Record<FlagTarget, string> = { post: "Report this report", comment: "Report this comment", user: "Report this account" };
const THANKS: Record<FlagTarget, string> = {
  post: "A moderator will review this report. If several people report it, it's hidden until then. You can also block the person so you don't see their posts.",
  comment:
    "A moderator will review this comment. If several people report it, it's hidden until then. You can also block the person so you don't see their posts.",
  user: "A moderator will review this account. If several people report it, it's hidden until then. You can also block the person so you don't see their posts.",
};

/**
 * Report something to the moderators: a reason and optional details. A native
 * modal <dialog> handles focus, Escape and the backdrop.
 */
export function ReportDialog({ type, id, onClose }: { type: FlagTarget; id: string; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [details, setDetails] = useState("");
  const submit = useMutation({ mutationFn: () => sendJson("/api/flags", "POST", { type, id, reason, details: details.trim() || undefined }) });

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${uid}-title`}
      onClose={onClose}
      onMouseDown={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-auto w-[min(28rem,calc(100vw-32px))] rounded-[var(--radius-panel,10px)] border border-line bg-surface-1 p-0 text-ink shadow-2xl backdrop:bg-black/60"
    >
      {submit.isSuccess ? (
        <div className="space-y-3 p-5">
          <h2 id={`${uid}-title`} className="text-[15px] font-semibold">
            {t("Thanks for letting us know")}
          </h2>
          <p className="text-sm leading-relaxed text-ink-2">{t(THANKS[type])}</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => ref.current?.close()}>
              {t("Done")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) submit.mutate();
          }}
        >
          <div>
            <h2 id={`${uid}-title`} className="text-[15px] font-semibold">
              {t(TITLE[type])}
            </h2>
            <p className="mt-0.5 text-xs text-ink-3">{t("Reports go to the moderators. The person you report isn't told who reported them.")}</p>
          </div>
          <fieldset className="space-y-1">
            <legend className="sr-only">{t("Reason")}</legend>
            {FLAG_REASON_IDS.map((r) => (
              <label key={r} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-sm hover:bg-surface-2 pointer-coarse:min-h-11">
                <input
                  type="radio"
                  name={`${uid}-reason`}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="size-4 shrink-0 accent-[var(--color-accent)]"
                />
                {t(FLAG_REASONS[r])}
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="label">{t("Details (optional)")}</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full resize-none rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent pointer-coarse:text-base"
              placeholder={t("Anything that helps the moderators understand")}
            />
          </label>
          {submit.error && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-xs text-ink-2">
              {errorText(t, (submit.error as Error).message)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => ref.current?.close()}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" disabled={!reason || submit.isPending}>
              {submit.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("Send report")}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export interface MenuAction {
  label: string;
  icon: "report" | "block" | "delete" | "remove";
  danger?: boolean;
  onSelect: () => void;
}

const ICONS = { report: Flag, block: Ban, delete: Trash2, remove: ShieldX } as const;

const MENU_ITEM_PX = 40;

/**
 * "⋯" button with a short list of actions; closes on outside click, Escape,
 * scroll or selection. The list is fixed to the viewport (below the button,
 * or above it near the bottom of the screen) so card edges can't clip it.
 */
export function ActionMenu({ label, actions, size = "sm" }: { label: string; actions: MenuAction[]; size?: "sm" | "md" }) {
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const open = pos != null;
  const root = useRef<HTMLDivElement>(null);
  const close = () => setPos(null);
  const toggle = (button: HTMLElement) => {
    if (open) return close();
    const r = button.getBoundingClientRect();
    const height = actions.length * MENU_ITEM_PX + 8;
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(r.bottom + 4 + height > window.innerHeight - 8 ? { right, bottom: window.innerHeight - r.top + 4 } : { right, top: r.bottom + 4 });
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);
  if (!actions.length) return null;
  return (
    <div ref={root} className="relative">
      <IconButton label={label} size={size} aria-haspopup="menu" aria-expanded={open} onClick={(e) => toggle(e.currentTarget)}>
        <MoreHorizontal className="size-4" aria-hidden />
      </IconButton>
      {open && (
        <div role="menu" style={pos} className="surface fixed z-[80] min-w-48 overflow-hidden py-1 shadow-xl">
          {actions.map((a) => {
            const Icon = ICONS[a.icon];
            return (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  a.onSelect();
                }}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2.5 px-3 text-left text-[13px] whitespace-nowrap hover:bg-surface-2 pointer-coarse:min-h-11",
                  a.danger ? "text-nogo" : "text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
