import type { Metadata } from "next";
import { AlertsSettings } from "@/components/alerts/alerts-settings";
import { SubpageShell } from "@/components/shell/subpage-shell";

export const metadata: Metadata = {
  title: "Alerts and places",
  description: "Warning notifications for saved places, and custom forecast alerts.",
};

export default function AlertsPage() {
  return (
    <SubpageShell width="max-w-2xl">
      <header className="mb-5 sm:mb-6">
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Alerts and places</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">Warning notifications for the places you care about, and alerts for the conditions you’re waiting for.</p>
      </header>
      <AlertsSettings />
    </SubpageShell>
  );
}
