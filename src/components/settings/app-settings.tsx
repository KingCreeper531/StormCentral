"use client";

import { Bell, ChevronDown, ChevronRight, Download, Monitor, Moon, Radio, RefreshCw, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { checkForUpdate, installedVersion, type AvailableUpdate } from "@/lib/native/app-update";
import { appUpdater, appUpdaterAvailable, type UpdaterStatus } from "@/lib/native/app-updater";
import { desktopBridge, type DesktopUpdateStatus } from "@/lib/native/desktop";
import { COMMUNITY_ENABLED, GITHUB_REPO, isNativeApp } from "@/lib/platform";
import { deviceZone, type ClockPref, type ZonePref } from "@/lib/clock";
import { LANGS, type LangPref } from "@/lib/i18n/lang";
import { useT } from "@/lib/i18n/use-t";
import type { ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { selectActiveTheme, useAddonsStore } from "@/store/addons-store";
import { UNIT_PRESETS, type DistanceUnit, type HeightUnit, type PrecipUnit, type PressureUnit, type TempUnit, type UnitPrefs, type WindUnit } from "@/lib/weather/units";
import { MAX_GAUGE_RADIUS_KM, RADIUS_KM, RADIUS_MI, useAppStore } from "@/store/app-store";
import { useProStore } from "@/store/pro-store";
import { useForecast, useSession } from "@/hooks/queries";
import { Button, buttonClass } from "../ui/button";
import { Skeleton, Toggle } from "../ui/misc";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";
import { Tabs } from "../ui/tabs";
import { MapStyleControls } from "../map/map-style-controls";
import { AccountSection } from "./account-panel";
import { ChaserPanel } from "./chaser-panel";
import { AddonsSection, ThemePicker } from "./addons-panel";
import { DesktopSettings } from "./desktop-settings";
import { WidgetPanel } from "./widget-panel";
import { UpdateButton } from "../shell/update-button";

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

function AppearancePanel({ onBrowse }: { onBrowse: () => void }) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const custom = useAddonsStore(selectActiveTheme);
  const t = useT();
  return (
    <Panel title={t("Appearance")}>
      {/* Both words, so the row is findable whichever language is showing. */}
      <Row label={t.lang === "es" ? "Idioma" : "Language · Idioma"}>
        <Segmented<LangPref>
          ariaLabel={t("Language")}
          stretch
          value={language}
          onChange={setLanguage}
          options={LANGS.map((l) => ({ value: l.id, label: l.id === "auto" ? t("Automatic") : l.label }))}
        />
      </Row>
      <Row label={t("Mode")}>
        <Segmented<ThemePref>
          ariaLabel={t("Theme")}
          stretch
          value={theme}
          onChange={setTheme}
          options={[
            {
              value: "system",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Monitor className="size-3.5" aria-hidden /> {t("System")}
                </span>
              ),
            },
            {
              value: "light",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Sun className="size-3.5" aria-hidden /> {t("Light")}
                </span>
              ),
            },
            {
              value: "dark",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Moon className="size-3.5" aria-hidden /> {t("Dark")}
                </span>
              ),
            },
          ]}
        />
      </Row>
      <p className="label">
        {custom
          ? custom.followSun
            ? t("\"{name}\" is light while the sun is up and dark at night.", { name: custom.name })
            : custom.base === "light"
              ? t("\"{name}\" sets its own light mode while it's on.", { name: custom.name })
              : t("\"{name}\" sets its own dark mode while it's on.", { name: custom.name })
          : t("System follows your device's light or dark setting.")}
      </p>
      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-sm text-ink">{t("Color theme")}</p>
        <ThemePicker onBrowse={onBrowse} />
      </div>
    </Panel>
  );
}

function UnitsPanel() {
  const units = useAppStore((s) => s.units);
  const setUnits = useAppStore((s) => s.setUnits);
  const preset = presetOf(units);
  const [open, setOpen] = useState(false);
  const expanded = open || preset === "custom";
  const t = useT();
  return (
    <Panel title={t("Units")} subtitle={preset === "custom" ? t("Custom mix") : undefined}>
      <Row label={t("System")}>
        <Segmented<Preset>
          ariaLabel={t("Unit system")}
          stretch
          value={preset}
          onChange={(p) => p !== "custom" && setUnits(p)}
          options={[
            { value: "imperial", label: t("US") },
            { value: "metric", label: t("Metric") },
            { value: "custom", label: t("Custom"), disabled: preset !== "custom" },
          ]}
        />
      </Row>
      {!expanded && (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-ink-2 underline-offset-2 hover:underline">
          {t("Set each unit separately")} <ChevronDown className="size-3.5" aria-hidden />
        </button>
      )}
      <div className={cn("divide-y divide-line border-t border-line", !expanded && "hidden")}>
        {UNIT_ROWS.map((r) => (
          <Row key={r.key} label={t(r.label)}>
            <Segmented
              ariaLabel={t(r.label)}
              size="sm"
              stretch
              value={units[r.key] as string}
              onChange={(v) => setUnits({ [r.key]: v } as Partial<UnitPrefs>)}
              options={r.options.map((o) => ({ ...o, label: t(o.label) }))}
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
  /** The Mac app: it can't install updates, so it offers the download. */
  | { kind: "download"; latest: string | null; url: string }
  | { kind: "store" }
  | { kind: "error" };

const fromDesktop = (s: DesktopUpdateStatus): Check =>
  s.state === "store"
    ? { kind: "store" }
    : s.state === "available" && s.downloadUrl?.startsWith("https://")
      ? { kind: "download", latest: s.latest, url: s.downloadUrl }
      : s.state === "ready"
        ? { kind: "ready", latest: s.latest }
        : s.state === "downloading"
          ? { kind: "downloading", latest: s.latest }
          : s.state === "error"
            ? { kind: "error" }
            : { kind: "current", latest: s.latest };

/** Android 0.4.3+: in-app install and the automatic-updates switch. */
function useInAppUpdates(host: Host) {
  const available = useSyncExternalStore(noSubscribe, appUpdaterAvailable, () => false) && host === "android";
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  useEffect(() => {
    if (!available) return;
    let live = true;
    void appUpdater.status().then((s) => live && setStatus(s), () => {});
    return () => {
      live = false;
    };
  }, [available]);
  const setAuto = (enabled: boolean) => {
    setStatus((s) => (s ? { ...s, auto: enabled } : s));
    void appUpdater.setAuto({ enabled }).catch(() => {});
  };
  return { available, status, setAuto };
}

/** Installed version and a "Check for updates" button (Windows and Android apps). */
function UpdatesPanel() {
  const host = useSyncExternalStore(noSubscribe, hostSnapshot, () => "web" as Host);
  const [version, setVersion] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const inApp = useInAppUpdates(host);
  const [installText, setInstallText] = useState<string | null>(null);
  const t = useT();

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
    <Panel title={t("Updates")} subtitle={version ? `Storm Central ${version}` : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        {check.kind === "ready" ? (
          <Button variant="primary" onClick={() => void desktopBridge()?.installUpdate?.()}>
            <Download className="size-4" aria-hidden />
            {t("Restart to install {version}", { version: check.latest ?? "" })}
          </Button>
        ) : check.kind === "available" && inApp.available ? (
          <UpdateButton version={check.update.version} size="md" onStatus={setInstallText} />
        ) : check.kind === "available" ? (
          <a href={check.update.apkUrl} className={buttonClass("primary")}>
            <Download className="size-4" aria-hidden />
            {t("Download {version}", { version: check.update.version })}
          </a>
        ) : check.kind === "download" ? (
          // The desktop app opens other sites in the default browser.
          <a href={check.url} target="_blank" rel="noreferrer" className={buttonClass("primary")}>
            <Download className="size-4" aria-hidden />
            {t("Download {version}", { version: check.latest ?? "" })}
          </a>
        ) : check.kind === "store" ? null : legacyDesktop ? (
          <a href={releases} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
            {t("Open the Releases page")}
          </a>
        ) : (
          <Button onClick={() => void run()} disabled={check.kind === "checking" || check.kind === "downloading"}>
            <RefreshCw className={check.kind === "checking" ? "size-4 animate-spin" : "size-4"} aria-hidden />
            {check.kind === "checking" ? t("Checking") : t("Check for updates")}
          </Button>
        )}
        <p role="status" className="text-sm text-ink-2">
          {check.kind === "current" && t("You have the latest version.")}
          {check.kind === "store" && t("This copy updates through the Microsoft Store, which installs new versions automatically.")}
          {check.kind === "downloading" &&
            (check.latest
              ? t("Downloading {version}. You'll be asked to restart when it's ready.", { version: check.latest })
              : t("Downloading the update. You'll be asked to restart when it's ready."))}
          {check.kind === "ready" && t("The update is downloaded.")}
          {check.kind === "available" &&
            (installText ??
              (inApp.available
                ? t("Version {version} is available. Your settings stay.", { version: check.update.version })
                : t("Version {version} is available. Install it over this one; your settings stay.", { version: check.update.version })))}
          {check.kind === "download" &&
            t("Version {version} is available. Open the download and drag Storm Central to Applications to replace this copy; your settings stay.", {
              version: check.latest ?? "",
            })}
          {check.kind === "error" && t("Couldn't reach GitHub. Check your connection and try again.")}
        </p>
      </div>
      {inApp.available && inApp.status && (
        <div className="mt-3 border-t border-line pt-1">
          <Toggle label={t("Install updates automatically")} checked={inApp.status.auto} onChange={inApp.setAuto} />
          <p className="label">
            {inApp.status.auto
              ? inApp.status.silent
                ? t("New versions install in the background while you're not using the app.")
                : t("New versions download in the background; Android asks you to tap Install. After the first in-app update, Android 12 and newer install them without asking.")
              : t("You'll get a notification when a new version is out.")}
          </p>
          {inApp.status.state === "failed" && inApp.status.error && <p className="mt-1 text-xs text-nogo">{inApp.status.error}</p>}
        </div>
      )}
      <p className="label mt-3">
        {host === "desktop" && check.kind === "store"
          ? t("Microsoft Store apps update in the background.")
          : host === "desktop"
          ? t("The app also checks on its own when it starts and every few hours.")
          : inApp.available
            ? t("The app checks every few hours, and when it opens.")
            : t("The app also checks when it opens and shows a notice when a new version is out.")}
      </p>
    </Panel>
  );
}

/** Readable zone name: "Central Daylight Time (America/Chicago)". */
function zoneLabel(tz: string, locale?: string) {
  try {
    const long = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    return long ? `${long} (${tz.replaceAll("_", " ")})` : tz;
  } catch {
    return tz;
  }
}

/** 12/24-hour clock and which time zone times are shown in. */
function TimePanel() {
  const clock = useAppStore((s) => s.clock);
  const setClock = useAppStore((s) => s.setClock);
  const zoneMode = useAppStore((s) => s.timeZoneMode);
  const setZoneMode = useAppStore((s) => s.setTimeZoneMode);
  const location = useAppStore((s) => s.location);
  const forecast = useForecast();
  const placeZone = forecast.data?.timezone ?? null;
  const device = useSyncExternalStore(noSubscribe, deviceZone, () => null);
  const t = useT();
  const zone = (tz: string) => zoneLabel(tz, t.locale);
  // A fixed afternoon time, to show the clock style.
  const sample = new Intl.DateTimeFormat(t.locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(clock !== "auto" && { hourCycle: clock === "12" ? "h12" : "h23" }),
  }).format(new Date(2026, 0, 1, 15, 30));

  let note: string;
  if (zoneMode === "device") note = device ? t("Always {zone}, this device's zone.", { zone: zone(device) }) : t("Always this device's zone.");
  else if (!placeZone)
    note =
      location.source === "gps" && device
        ? t("Using {zone} until your location's forecast loads.", { zone: zone(device) })
        : t("Times follow the zone of the place you're viewing.");
  else if (location.source === "gps") note = t("Detected from your location: {zone}. It changes on its own when you cross into another zone.", { zone: zone(placeZone) });
  else note = t("Following {place}: {zone}. Turn on My location to use the zone you're in.", { place: location.name, zone: zone(placeZone) });

  return (
    <Panel title={t("Time")} subtitle={t("Times look like {time}", { time: sample })}>
      <Row label={t("Clock")}>
        <Segmented<ClockPref>
          ariaLabel={t("Clock")}
          stretch
          value={clock}
          onChange={setClock}
          options={[
            { value: "auto", label: t("Automatic") },
            { value: "12", label: t("12-hour") },
            { value: "24", label: t("24-hour") },
          ]}
        />
      </Row>
      <Row label={t("Time zone")}>
        <Segmented<ZonePref>
          ariaLabel={t("Time zone")}
          stretch
          value={zoneMode}
          onChange={setZoneMode}
          options={[
            { value: "auto", label: t("Automatic") },
            { value: "device", label: t("This device") },
          ]}
        />
      </Row>
      <p className="label">{note}</p>
    </Panel>
  );
}

/** Keep My location up to date while moving. */
function LocationPanel() {
  const follow = useAppStore((s) => s.followLocation);
  const setFollow = useAppStore((s) => s.setFollowLocation);
  const gps = useAppStore((s) => s.location.source === "gps");
  const t = useT();
  return (
    <Panel title={t("Location")}>
      <Toggle label={t("Follow me as I move")} checked={follow} onChange={setFollow} />
      <p className="label mt-1">
        {gps
          ? t("With My location on, the forecast, warnings and town name update as you travel, about every 2 km.")
          : t("Works when My location is selected: tap the search bar and choose Use my current location.")}
      </p>
    </Panel>
  );
}

/** Professional mode: adds the Pro workspace to the modes. */
function ProfessionalPanel() {
  const on = useAppStore((s) => s.professional);
  const setOn = useAppStore((s) => s.setProfessional);
  const setMode = useAppStore((s) => s.setMode);
  const guideButton = useProStore((s) => s.guideButton);
  const setGuideButton = useProStore((s) => s.setGuideButton);
  const t = useT();
  return (
    <Panel title={t("Professional mode")}>
      <Toggle label={t("Professional mode")} checked={on} onChange={setOn} />
      <p className="label mt-1">
        {t(
          "Adds Pro to the modes: an AWIPS-style workspace with up to nine synced radar and satellite panels, cursor sampling, model soundings, cross-sections and storm tracking tools.",
        )}
      </p>
      {on && (
        <>
          <div className="mt-3">
            <Toggle label={t("Guide button")} checked={guideButton} onChange={setGuideButton} />
            <p className="label">
              {t("Shows a Guide button in Pro's toolbar: an optional tour of the workspace and what every product, tool and term means. Nothing opens unless you press it.")}
            </p>
          </div>
          <Button size="sm" className="mt-3" onClick={() => setMode("professional")}>
            {t("Open Pro")}
          </Button>
        </>
      )}
    </Panel>
  );
}

/** How far to look for warnings, spotter reports and river gauges. */
function RadiusPanel() {
  const radiusKm = useAppStore((s) => s.radiusKm);
  const setRadiusKm = useAppStore((s) => s.setRadiusKm);
  const miles = useAppStore((s) => s.units.distance === "mi");
  const t = useT();
  const options = miles
    ? RADIUS_MI.map((mi) => ({ value: Math.round(mi * 1.609344), label: `${mi} mi` }))
    : RADIUS_KM.map((km) => ({ value: km, label: `${km} km` }));
  // The stored value may come from the other unit system: highlight the nearest choice.
  const current = options.reduce((best, o) => (Math.abs(o.value - radiusKm) < Math.abs(best.value - radiusKm) ? o : best)).value;
  const gaugeCap = miles ? `${Math.round(MAX_GAUGE_RADIUS_KM / 1.609344)} mi` : `${MAX_GAUGE_RADIUS_KM} km`;
  return (
    <Panel title={t("Search radius")} subtitle={t("How far to look for warnings, spotter reports and river gauges")}>
      <Segmented<number> ariaLabel={t("Search radius")} stretch size="sm" value={current} onChange={setRadiusKm} options={options} />
      <p className="label mt-2">{t("River gauges stop at {distance}.", { distance: gaugeCap })}</p>
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

type Section = "general" | "alerts" | "account" | "addons" | "app";
const SECTIONS: Section[] = ["general", "alerts", "account", "addons", "app"];

// The open section lives in the URL hash (#addons), so links and Back work.
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
const hashSection = (): Section => {
  const h = window.location.hash.slice(1) as Section;
  return SECTIONS.includes(h) ? h : "general";
};
function openSection(s: Section) {
  history.replaceState(null, "", s === "general" ? window.location.pathname + window.location.search : `#${s}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function SignedOutAccount() {
  const t = useT();
  return (
    <Panel>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-2 text-ink-2">
          <UserRound className="size-4" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-sm text-ink-2">{t("Sign in to post spotter reports and set a profile picture, name and bio.")}</p>
        <Link href="/login?next=%2Fsettings%23account" className={buttonClass("primary")}>
          {t("Sign in")}
        </Link>
      </div>
    </Panel>
  );
}

/** /settings: grouped into tabs so each screen stays short. Stored on this device. */
export function AppSettings() {
  const hydrated = useAppStore((s) => s.hydrated);
  const section = useSyncExternalStore(subscribeHash, hashSection, () => "general" as Section);
  const host = useSyncExternalStore(noSubscribe, hostSnapshot, () => "web" as Host);
  const signedIn = !!useSession().data;
  const t = useT();
  if (!hydrated) return <Skeleton className="h-96 w-full" />;
  const tabs = [
    { value: "general" as const, label: t("General") },
    { value: "alerts" as const, label: t("Alerts") },
    { value: "account" as const, label: t("Account") },
    { value: "addons" as const, label: t("Add-ons") },
    ...(host === "web" ? [] : [{ value: "app" as const, label: t("App") }]),
  ];
  const current = tabs.some((tab) => tab.value === section) ? section : "general";
  return (
    <div>
      <div className="-mx-4 mb-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <Tabs<Section> ariaLabel={t("Settings sections")} items={tabs} value={current} onChange={openSection} className="gap-5" />
      </div>
      <div className="space-y-4" role="tabpanel">
        {current === "general" && (
          <>
            <AppearancePanel onBrowse={() => openSection("addons")} />
            <Panel title={t("Map style")} subtitle={t("Basemap, terrain, borders, roads and labels on every map")}>
              <MapStyleControls />
            </Panel>
            <UnitsPanel />
            <TimePanel />
            <LocationPanel />
            <RadiusPanel />
            <ProfessionalPanel />
            {/* Broadcast mode has a page of its own, off the radar. */}
            <LinkRow href="/broadcast" icon={<Radio className="size-4" aria-hidden />} title={t("Broadcast mode")} sub={t("On-air graphics for streaming the radar")} />
          </>
        )}
        {current === "alerts" && (
          <>
            <LinkRow href="/alerts" icon={<Bell className="size-4" aria-hidden />} title={t("Alerts and places")} sub={t("Warning notifications, saved places and custom alerts")} />
            <WidgetPanel />
          </>
        )}
        {current === "account" &&
          (signedIn ? (
            <>
              <AccountSection />
              {COMMUNITY_ENABLED && <ChaserPanel />}
            </>
          ) : (
            <SignedOutAccount />
          ))}
        {current === "addons" && <AddonsSection />}
        {current === "app" && (
          <>
            <UpdatesPanel />
            <DesktopSettings />
          </>
        )}
        <p className="text-xs text-ink-3">
          {t("Settings are saved on this device.")}{" "}
          <a href={`https://github.com/${GITHUB_REPO}/releases/latest`} target="_blank" rel="noreferrer" className="text-ink-2 underline-offset-2 hover:underline">
            {t("Latest version and release notes")}
          </a>
          {" · "}
          <Link href="/privacy" className="text-ink-2 underline-offset-2 hover:underline">
            {t("Privacy policy")}
          </Link>
        </p>
      </div>
    </div>
  );
}
