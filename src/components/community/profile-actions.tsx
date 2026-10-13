"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/hooks/queries";
import { ActionMenu, confirmBlock, ReportDialog, useBlock, type MenuAction } from "./moderation";

/**
 * Block/unblock and report on someone else's profile. `blocked` is whether
 * the viewer has blocked them (from the server render); the page re-renders
 * after a change so the feed follows.
 */
export function ProfileActions({ username, displayName, userId, blocked }: { username: string; displayName: string; userId: string; blocked: boolean }) {
  const { data: viewer } = useSession();
  const router = useRouter();
  const block = useBlock();
  const [reporting, setReporting] = useState(false);
  if (!viewer || viewer.id === userId) return null;

  const actions: MenuAction[] = [
    blocked
      ? { label: `Unblock ${displayName}`, icon: "block", onSelect: () => block.mutate({ username, blocked: false }, { onSuccess: () => router.refresh() }) }
      : {
          label: `Block ${displayName}`,
          icon: "block",
          danger: true,
          onSelect: () => confirmBlock(displayName) && block.mutate({ username, blocked: true }, { onSuccess: () => router.refresh() }),
        },
    { label: "Report account", icon: "report", onSelect: () => setReporting(true) },
  ];
  return (
    <>
      <ActionMenu label="Account actions" actions={actions} size="md" />
      {block.error && (
        <p role="alert" className="sr-only">
          {(block.error as Error).message}
        </p>
      )}
      {reporting && <ReportDialog type="user" id={username} onClose={() => setReporting(false)} />}
    </>
  );
}
