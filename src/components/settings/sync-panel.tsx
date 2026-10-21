"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { useT } from "@/lib/i18n/use-t";
import { timeAgo } from "@/lib/time";
import { disableSync, enableSync, forgetRemote, remoteDiffers, syncNow, syncOnFor, useSyncStatus } from "@/lib/sync/client";
import { Button } from "../ui/button";
import { Toggle } from "../ui/misc";
import { Panel } from "../ui/panel";

/**
 * Settings sync (lib/sync): on for the signed-in account on this device, its
 * status, and the first-time choice between the account's settings and this
 * device's.
 */
export function SyncPanel() {
  const t = useT();
  const userId = useSession().data?.id ?? null;
  const sync = useSyncStatus();
  const [on, setOn] = useState(() => syncOnFor(userId));
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const now = useNow(30_000);
  if (!userId) return null;

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await remoteDiffers();
      if (r.has && r.differs) return setChoosing(true);
      await enableSync(userId, r.has ? "account" : "device");
      setOn(true);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = async (keep: "account" | "device") => {
    setBusy(true);
    setNote(null);
    try {
      await enableSync(userId, keep);
      setOn(true);
    } catch (err) {
      // Sync stayed off: the switch too, with the reason.
      setNote((err as Error).message);
    } finally {
      setBusy(false);
      setChoosing(false);
    }
  };
  const turnOff = () => {
    disableSync();
    setOn(false);
    setChoosing(false);
  };

  const ago = sync.at ? timeAgo(sync.at, now, t) : null;
  const statusText =
    sync.state === "syncing"
      ? t("Syncing…")
      : sync.state === "error"
        ? t("Couldn't sync: {why}", { why: sync.error ?? t("no connection") })
        : sync.state === "synced"
          ? ago
            ? t("Up to date ({ago})", { ago })
            : t("Up to date")
          : null;

  return (
    <Panel title={t("Sync settings")} subtitle={t("Between your computer, phone and the web, through your account")}>
      <div className="space-y-3 text-[13px]">
        <Toggle label={t("Sync settings on this device")} checked={on || choosing} onChange={(v) => (v ? void turnOn() : turnOff())} />
        {choosing && (
          <div className="space-y-2 rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
            <p className="text-ink-2">{t("Your account already has settings from another device. Which should this device use?")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void choose("account")}>
                {t("The account's settings")}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void choose("device")}>
                {t("This device's (replace the account's)")}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setChoosing(false)}>
                {t("Cancel")}
              </Button>
            </div>
          </div>
        )}
        {on && statusText && (
          <div className="flex items-center justify-between gap-2">
            <p role="status" className={sync.state === "error" ? "text-caution" : "text-ink-3"}>
              {statusText}
            </p>
            <Button size="sm" variant="ghost" disabled={sync.state === "syncing"} onClick={() => void syncNow()}>
              <RefreshCw className="size-3.5" aria-hidden />
              {t("Sync now")}
            </Button>
          </div>
        )}
        <p className="text-[12px] text-ink-3">
          {t(
            "Syncs units, theme and language, radar and map style settings, map presets, colour tables, the Professional workspace, saved places and custom alerts, themes and plugins, custom layers from links, and broadcast graphics. Your location, the notifications switch, files you loaded, the broadcast logo and chaser sharing stay on each device.",
          )}
        </p>
        {!on && !choosing && (
          <button
            type="button"
            className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            onClick={async () => {
              try {
                await forgetRemote();
                setNote(t("Removed the settings kept on your account. Each device keeps its own."));
              } catch (err) {
                setNote((err as Error).message);
              }
            }}
          >
            {t("Remove the settings kept on your account")}
          </button>
        )}
        {note && (
          <p role="status" className="text-[12px] text-ink-3">
            {note}
          </p>
        )}
      </div>
    </Panel>
  );
}
