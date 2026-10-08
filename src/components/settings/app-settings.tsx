"use client";

import { Bell, ChevronRight, Download, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { checkForUpdate, installedVersion, type AvailableUpdate } from "@/lib/native/app-update";
import { desktopBridge, type DesktopUpdateStatus } from "@/lib/native/desktop";
import { GITHUB_REPO, isNativeApp } from "@/lib/platform";
import type { ThemePref } from "@/lib/theme";
import { UNIT_PRESETS, type DistanceUnit, type HeightUnit, type PrecipUnit, type PressureUnit, type TempUnit, type UnitPrefs, type WindUnit } from "@/lib/weather/units";
import { MAX_GAUGE_RADIUS_KM, RADIUS_KM, RADIUS_MI, useAppStore } from "@/store/app-store";
import { Button, buttonClass } from "../ui/button";
import { Skeleton } from "../ui/misc";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";
import { AccountSection } from "./account-panel";
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

const noSubscribe = () => () => {};
type Host = "web" | "desktop" | "android";
const hostSnapshot = (): Host => (desktopBridge() ? "desktop" : isNativeApp() ? "android" : "web");

type Check =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; latest: string | null }
  | { kind: "downloading"; latest: string | null }
  | { kind: "ready"; latest: string | null }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "error" };

const fromDesktop = (s: DesktopUpdateStatus): Check =>
  s.state === "ready"
    ? { kind: "ready", latest: s.latest }
    : s.state === "downloading"
      ? { kind: "downloading", latest: s.latest }
      : s.state === "error"
        ? { kind: "error" }
        : { kind: "current", latest: s.latest };

/** Installed version and a "Check for updates" button (Windows and Android apps). */
function UpdatesPanel() {
  const host = useSyncExternalStore(noSubscribe, hostSnapshot, () => "web" as Host);
  const [version, setVersion] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ kind: "idle" });

  useEffect(() => {
    let live = true;
    if (host === "android") void installedVersion().then((v) => live && setVersion(v), () => {});
    if (host === "desktop") {
      // Opening Settings checks once, so the version and any newer release show right away.
      const bridge = desktopBridge();
      if (bridge?.checkForUpdates) {
        void bridge.checkForUpdates().then(
          (st) => {
            if (!live) return;
            setVersion(st.current);
            setCheck(fromDesktop(st));
          },
          () => {},
        );
      }
    }
    return () => {
      live = false;
    };
  }, [host]);


  const run = async () => {
    setCheck({ kind: "checking" });
    try {
      if (host === "desktop") {
        const bridge = desktopBridge();
        if (!bridge?.checkForUpdates) throw new Error("unsupported");
        const st = await bridge.checkForUpdates();
        setVersion(st.current);
        setCheck(fromDesktop(st));
      } else {
        const update = await checkForUpdate({ force: true });
        setCheck(update ? { kind: "available", update } : { kind: "current", latest: null });
      }
    } catch {
      setCheck({ kind: "error" });
    }
  };

  if (host === "web") return null;
  const releases = `https://github.com/${GITHUB_REPO}/releases/latest`;
  const legacyDesktop = host === "desktop" && !desktopBridge()?.checkForUpdates;

  return (
    <Panel title="Updates" subtitle={version ? `StormCentral ${version}` : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        {check.kind === "ready" ? (
          <Button variant="primary" onClick={() => void desktopBridge()?.installUpdate?.()}>
            <Download className="size-4" aria-hidden />
            Restart to install {check.latest}
          </Button>
        ) : check.kind === "available" ? (
          <a href={check.update.apkUrl} className={buttonClass("primary")}>
            <Download className="size-4" aria-hidden />
            Download {check.update.version}
          </a>
        ) : legacyDesktop ? (
          <a href={releases} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
            Open the Releases page
          </a>
        ) : (
          <Button onClick={() => void run()} disabled={check.kind === "checking" || check.kind === "downloading"}>
            <RefreshCw className={check.kind === "checking" ? "size-4 animate-spin" : "size-4"} aria-hidden />
            {check.kind === "checking" ? "Checking" : "Check for updates"}
          </Button>
        )}
        <p role="status" className="text-sm text-ink-2">
          {check.kind === "current" && "You have the latest version."}
          {check.kind === "downloading" && `Downloading ${check.latest ?? "the update"}. You'll be asked to restart when it's ready.`}
          {check.kind === "ready" && "The update is downloaded."}
          {check.kind === "available" && `Version ${check.update.version} is available. Install it over this one; your settings stay.`}
          {check.kind === "error" && "Couldn't reach GitHub. Check your connection and try again."}
        </p>
      </div>
      <p className="label mt-3">
        {host === "desktop"
          ? "The app also checks on its own when it starts and every few hours."
          : "The app also checks when it opens and shows a notice when a new version is out."}
      </p>
    </Panel>
  );
}

/** How far to look for warnings, spotter reports and river gauges. */
function RadiusPanel() {
  const radiusKm = useAppStore((s) => s.radiusKm);
  const setRadiusKm = useAppStore((s) => s.setRadiusKm);
  const miles = useAppStore((s) => s.units.distance === "mi");
  const options = miles
    ? RADIUS_MI.map((mi) => ({ value: Math.round(mi * 1.609344), label: `${mi} mi` }))
    : RADIUS_KM.map((km) => ({ value: km, label: `${km} km` }));
  // The stored value may come from the other unit system: highlight the nearest choice.
  const current = options.reduce((best, o) => (Math.abs(o.value - radiusKm) < Math.abs(best.value - radiusKm) ? o : best)).value;
  const gaugeCap = miles ? `${Math.round(MAX_GAUGE_RADIUS_KM / 1.609344)} mi` : `${MAX_GAUGE_RADIUS_KM} km`;
  return (
    <Panel title="Search radius" subtitle="How far to look for warnings, spotter reports and river gauges">
      <Segmented<number> ariaLabel="Search radius" stretch size="sm" value={current} onChange={setRadiusKm} options={options} />
      <p className="label mt-2">River gauges stop at {gaugeCap}.</p>
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
      <RadiusPanel />
      <LinkRow href="/alerts" icon={<Bell className="size-4" aria-hidden />} title="Alerts and places" sub="Warning notifications, saved places and custom alerts" />
      <AccountSection />
      <UpdatesPanel />
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
