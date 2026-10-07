import { Users } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "../ui/button";
import { EmptyState } from "../ui/misc";
import { Panel } from "../ui/panel";

/** Shown on community pages in builds without the server (the Android app's bundled build). */
export function CommunityUnavailable() {
  return (
    <Panel>
      <EmptyState icon={<Users className="size-5 text-ink-3" aria-hidden />} title="The spotter network isn't available in this app">
        <p>Accounts and reports need the StormCentral server, and this version runs without one. Weather, radar and every mode work as usual.</p>
        <Link href="/" className={buttonClass("secondary", "sm", "mt-3")}>
          Back to weather
        </Link>
      </EmptyState>
    </Panel>
  );
}
