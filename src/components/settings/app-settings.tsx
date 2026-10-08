"use client";

import { Bell, ChevronRight, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { GITHUB_REPO } from "@/lib/platform";
import type { ThemePref } from "@/lib/theme";
import { UNIT_PRESETS, type DistanceUnit, type HeightUnit, type PrecipUnit, type PressureUnit, type TempUnit, type UnitPrefs, type WindUnit } from "@/lib/weather/units";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "../ui/misc";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";
import { DesktopSettings } from "./desktop-settings";

type Preset = "imperial" | "metric" | "custom";

const UNIT_ROWS: { key: keyof UnitPrefs; label: string; options: { value: string; label: string }[] }[] = [
  { key: "temp", label: "Temperature", options: [{ value: "F", label: "°F" } satisfies { value: TempUnit; label: string }, { value: "C", label: "°C" }] },
  {
    key: "wind",
    label: "Wind speed",
    options: [
      { value: "mph" satisfies WindUnit, label: "mph" },
      { value: "kmh", label: "km/h" },
      { value: "ms", label: "m/s" },
      { value: "kn", label: "knots" },
    ],
  },
  { key: "pressure", label: "Pressure", options: [{ value: "inHg" satisfies PressureUnit, label: "inHg" }, { value: "hPa", label: "hPa" }] },
  { key: "distance", label: "Distance", options: [{ value: "mi" satisfies DistanceUnit, label: "Miles" }, { value: "km", label: "Kilometres" }] },
  { key: "precip", label: "Rain and hail", options: [{ value: "in" satisfies PrecipUnit, label: "Inches" }, { value: "mm", label: "Millimetres" }] },
  { key: "height", label: "Height and altitude", options: [{ value: "ft" satisfies HeightUnit, label: "Feet" }, { value: "m", label: "Metres" }] },
];

function presetOf(u: UnitPrefs): Preset {
  const same = (p: UnitPrefs) => (Object.keys(p) as (keyof UnitPrefs)[]).every((k) => p[k] === u[k]);
  return same(UNIT_PRESETS.imperial) ? "imperial" : same(UNIT_PRESETS.metric) ? "metric" : "custom";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-ink">{label}</span>
      <div className="min-w-0 sm:w-80">{children}</div>
    </div>
  );
}

function AppearancePanel() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <Panel title="Appearance">
      <Row label="Theme">
        <Segmented<ThemePref>
          ariaLabel="Theme"
          stretch
          value={theme}
          onChange={setTheme}
          options={[
            {
              value: "system",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Monitor className="size-3.5" aria-hidden /> System
                </span>
              ),
            },
            {
              value: "light",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Sun className="size-3.5" aria-hidden /> Light
                </span>
              ),
            },
            {
              value: "dark",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Moon className="size-3.5" aria-hidden /> Dark
                </span>
              ),
            },
          ]}
        />
      </Row>
      <p className="label">System follows your device&apos;s light or dark setting.</p>
    </Panel>
  );
}

function UnitsPanel() {
  const units = useAppStore((s) => s.units);
  const setUnits = useAppStore((s) => s.setUnits);
  const preset = presetOf(units);
  return (
    <Panel title="Units" subtitle={preset === "custom" ? "Custom mix" : undefined}>
      <Row label="System">
        <Segmented<Preset>
          ariaLabel="Unit system"
          stretch
          value={preset}
          onChange={(p) => p !== "custom" && setUnits(p)}
          options={[
            { value: "imperial", label: "US" },
            { value: "metric", label: "Metric" },
            { value: "custom", label: "Custom", disabled: preset !== "custom" },
          ]}
        />
      </Row>
      <div className="divide-y divide-line border-t border-line">
        {UNIT_ROWS.map((r) => (
          <Row key={r.key} label={r.label}>
            <Segmented
              ariaLabel={r.label}
              size="sm"
              stretch
              value={units[r.key] as string}
              onChange={(v) => setUnits({ [r.key]: v } as Partial<UnitPrefs>)}
              options={r.options}
            />
          </Row>
        ))}
      </div>
    </Panel>
  );
}

function LinkRow({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link href={href} className="surface flex items-center gap-3 p-4 transition-colors hover:border-line-strong sm:px-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-2 text-ink-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block truncate text-xs text-ink-3">{sub}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

/** /settings: appearance, units, notifications and (Windows app) tray options. Stored on this device. */
export function AppSettings() {
  const hydrated = useAppStore((s) => s.hydrated);
  if (!hydrated) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-4">
      <AppearancePanel />
      <UnitsPanel />
      <LinkRow href="/alerts" icon={<Bell className="size-4" aria-hidden />} title="Alerts and places" sub="Warning notifications, saved places and custom alerts" />
      <DesktopSettings />
      <p className="text-xs text-ink-3">
        Settings are saved on this device.{" "}
        <a href={`https://github.com/${GITHUB_REPO}/releases/latest`} target="_blank" rel="noreferrer" className="text-ink-2 underline-offset-2 hover:underline">
          Latest version and release notes
        </a>
      </p>
    </div>
  );
}
