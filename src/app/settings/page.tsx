import type { Metadata } from "next";
import { AppSettings } from "@/components/settings/app-settings";
import { SubpageShell } from "@/components/shell/subpage-shell";

export const metadata: Metadata = {
  title: "Settings",
  description: "Theme, units, notifications and app options.",
};

export default function SettingsPage() {
  return (
    <SubpageShell width="max-w-2xl">
      <header className="mb-5 sm:mb-6">
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Settings</h1>
      </header>
      <AppSettings />
    </SubpageShell>
  );
}
