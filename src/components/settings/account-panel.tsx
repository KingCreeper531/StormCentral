"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronRight, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { getJson } from "@/lib/api/http";
import { suspensionText, type BlockedUserDto } from "@/lib/community";
import { useT } from "@/lib/i18n/use-t";
import { qk, useSession } from "@/hooks/queries";
import { Field, INPUT } from "../community/auth-form";
import { useBlock } from "../community/moderation";
import { ChangePasswordPanel } from "../community/password-forms";
import { Button } from "../ui/button";
import { Avatar } from "../ui/misc";
import { Panel } from "../ui/panel";

interface Profile {
  username: string;
  email: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
}

const SIZE = 256;

/** Square-crops and shrinks a picture to 256 px on the device (WebP, JPEG where WebP isn't supported). */
async function squareAvatar(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't read that picture");
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bmp.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  const blob = webp?.type === "image/webp" ? webp : await encode("image/jpeg");
  if (!blob) throw new Error("Couldn't process that picture");
  return blob;
}

async function send(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

function ProfilePanel({ profile, hue }: { profile: Profile; hue: number }) {
  const qc = useQueryClient();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"picture" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const t = useT();

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["account"] }), qc.invalidateQueries({ queryKey: qk.session }), qc.invalidateQueries({ queryKey: ["posts"] })]);
  };
  const run = async (kind: "picture" | "save", fn: () => Promise<unknown>) => {
    setError(null);
    setSaved(false);
    setBusy(kind);
    try {
      await fn();
      await refresh();
      if (kind === "save") setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const upload = (file: File) =>
    run("picture", async () => {
      const fd = new FormData();
      fd.set("image", await squareAvatar(file), "avatar");
      await send("/api/account/avatar", { method: "POST", body: fd });
    });

  return (
    <Panel title={t("Profile")} subtitle={`@${profile.username} · ${profile.email}`}>
      <div className="flex items-center gap-4">
        <Avatar name={profile.displayName} hue={hue} src={profile.avatarUrl} size={64} />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === "picture" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
            {profile.avatarUrl ? t("Change picture") : t("Add picture")}
          </Button>
          {profile.avatarUrl && (
            <Button size="sm" variant="ghost" onClick={() => void run("picture", () => send("/api/account/avatar", { method: "DELETE" }))} disabled={busy !== null}>
              {t("Remove")}
            </Button>
          )}
        </div>
      </div>

      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run("save", () =>
            send("/api/account", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ displayName: String(f.get("displayName") ?? ""), bio: String(f.get("bio") ?? "") }),
            }),
          );
        }}
      >
        <Field id={`${uid}-name`} label={t("Display name")}>
          <input id={`${uid}-name`} name="displayName" defaultValue={profile.displayName} maxLength={40} required autoComplete="nickname" className={INPUT} />
        </Field>
        <Field id={`${uid}-bio`} label={t("Bio")} optional hint={t("Shown on your profile, up to 300 characters.")}>
          <textarea
            id={`${uid}-bio`}
            name="bio"
            defaultValue={profile.bio ?? ""}
            maxLength={300}
            rows={3}
            className={`${INPUT} h-auto min-h-20 py-2 pointer-coarse:h-auto`}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-xs text-ink-2">
            {t(error)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy !== null}>
            {busy === "save" && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("Save profile")}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-ink-2">
              {t("Saved.")}
            </span>
          )}
          <Link href={`/u/${profile.username}`} className="text-[13px] text-ink-2 hover:text-ink hover:underline">
            {t("View my profile")}
          </Link>
        </div>
      </form>
    </Panel>
  );
}

/** Accounts this person has blocked, each with Unblock. */
function BlockedAccountsPanel() {
  const blocked = useQuery({
    queryKey: ["blocks"],
    queryFn: ({ signal }) => getJson<{ blocked: BlockedUserDto[] }>("/api/blocks", { signal }).then((r) => r.blocked),
  });
  const unblock = useBlock();
  const list = blocked.data ?? [];
  const t = useT();
  return (
    <Panel title={t("Blocked accounts")} subtitle={t("You don't see each other's reports or comments, and can't interact")}>
      {blocked.isLoading && <p className="text-[13px] text-ink-3">{t("Loading…")}</p>}
      {blocked.error && <p className="text-[13px] text-ink-3">{t("Couldn't load your blocked accounts.")}</p>}
      {blocked.isSuccess && !list.length && (
        <p className="text-[13px] text-ink-3">{t("You haven't blocked anyone. Use the ⋯ menu on a report, comment or profile to block someone.")}</p>
      )}
      {list.length > 0 && (
        <ul className="-my-2 divide-y divide-line">
          {list.map((b) => (
            <li key={b.username} className="flex items-center gap-3 py-2">
              <Avatar name={b.displayName} hue={b.avatarHue} src={b.avatarUrl} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{b.displayName}</p>
                <p className="truncate text-xs text-ink-3">@{b.username}</p>
              </div>
              <Button size="sm" onClick={() => unblock.mutate({ username: b.username, blocked: false })} disabled={unblock.isPending}>
                {t("Unblock")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {unblock.error && (
        <p role="alert" className="mt-2 text-xs text-ink-2">
          {t((unblock.error as Error).message)}
        </p>
      )}
    </Panel>
  );
}

/** Moderators: a way into the review queue. */
function ModerationLink() {
  const t = useT();
  return (
    <Panel padded={false}>
      <Link href="/moderation" className="flex min-h-14 items-center gap-3 px-4 text-sm text-ink hover:bg-surface-2 sm:px-5">
        <ShieldCheck className="size-4 shrink-0 text-ink-3" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t("Moderation queue")}</span>
          <span className="block text-xs text-ink-3">{t("Review reported content and accounts")}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
      </Link>
    </Panel>
  );
}

function DeleteAccountPanel() {
  const uid = useId();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  return (
    <Panel title={t("Delete account")} subtitle={t("Removes your account, reports, photos and comments for good")}>
      {!open ? (
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" aria-hidden />
          {t("Delete my account")}
        </Button>
      ) : (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const password = String(new FormData(e.currentTarget).get("password") ?? "");
            setError(null);
            setBusy(true);
            void send("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })
              .then(async () => {
                await qc.invalidateQueries({ queryKey: qk.session });
                await qc.invalidateQueries({ queryKey: ["posts"] });
                router.push("/");
              })
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false));
          }}
        >
          <Field id={`${uid}-pw`} label={t("Type your password to confirm")}>
            <input id={`${uid}-pw`} name="password" type="password" required autoComplete="current-password" className={INPUT} />
          </Field>
          {error && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-xs text-ink-2">
              {t(error)}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("Delete forever")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/** Settings → Account: profile picture, name, bio, password, delete. Only when signed in. */
export function AccountSection() {
  const session = useSession();
  const profile = useQuery({
    queryKey: ["account"],
    queryFn: ({ signal }) => getJson<Profile>("/api/account", { signal }),
    enabled: !!session.data,
  });
  const t = useT();
  if (!session.data || !profile.data) return null;
  return (
    <>
      {session.data.suspendedUntil != null && (
        <p role="status" className="rounded-[var(--radius-control)] border border-nogo/30 bg-nogo/10 px-3 py-2 text-[13px] text-ink-2">
          {suspensionText(session.data.suspendedUntil, t)} {t("You can still read reports, but you can't post, comment, confirm or edit your profile.")}
        </p>
      )}
      {session.data.moderator && <ModerationLink />}
      <ProfilePanel key={`${profile.data.displayName}|${profile.data.bio ?? ""}`} profile={profile.data} hue={session.data.avatarHue} />
      <ChangePasswordPanel />
      <BlockedAccountsPanel />
      <DeleteAccountPanel />
    </>
  );
}
