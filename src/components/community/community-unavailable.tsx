"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/i18n/use-t";
import { buttonClass } from "../ui/button";
import { EmptyState } from "../ui/misc";
import { Panel } from "../ui/panel";

/** Shown on community pages in builds without the server (the Android app's bundled build). */
export function CommunityUnavailable() {
  const t = useT();
  return (
    <Panel>
      <EmptyState icon={<Users className="size-5 text-ink-3" aria-hidden />} title={t("The spotter network isn't available in this app")}>
        <p>{t("Accounts and reports need the Storm Central server, and this version runs without one. Weather, radar and every mode work as usual.")}</p>
        <Link href="/" className={buttonClass("secondary", "sm", "mt-3")}>
          {t("Back to weather")}
        </Link>
      </EmptyState>
    </Panel>
  );
}
