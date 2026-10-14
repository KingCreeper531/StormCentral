"use client";

import { useQuery } from "@tanstack/react-query";
import { BatteryCharging, Bell, MapPin, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { searchPlaces } from "@/lib/api/open-meteo";
import { fromDisplay, METRICS, metricDef, toDisplay, unitLabel, describeRule, type MetricGroup } from "@/lib/alerting/metrics";
import { nativePermission, showNativeNotification } from "@/lib/alerting/notify-native";
import { announcePermission, requestWebPermission, showWebNotification, webPermission } from "@/lib/alerting/notify-web";
import { ALERT_CATEGORIES, CURRENT_PLACE_ID, DEFAULT_BRIEFING, DEFAULT_LIGHTNING, DEFAULT_RAIN, DEFAULT_SPOTTER, RAIN_LEAD_CHOICES, type RuleMetric, type RuleOp } from "@/lib/alerting/types";
import { nativeAlerts, nativeAlertsAvailable, type NativeAlertsStatus } from "@/lib/native/storm-alerts";
import { runnerPermission } from "@/lib/native/runner-bridge";
import { COMMUNITY_ENABLED, isNativeApp } from "@/lib/platform";
import { timeAgo } from "@/lib/time";
import { useNow } from "@/hooks/use-now";
import { useSession } from "@/hooks/queries";
import { MAX_PLACES, MAX_RULES, useAlertsStore } from "@/store/alerts-store";
import { useAppStore } from "@/store/app-store";
import { Button, IconButton } from "../ui/button";
import { EmptyState, Skeleton, Toggle } from "../ui/misc";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";

const INPUT =
  "h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink outline-none focus:border-accent pointer-coarse:h-11";
const WINDOWS = [6, 12, 24, 48] as const;
const GROUPS: MetricGroup[] = ["Daily", "UAV pilot", "Angler", "Air quality"];
const noSubscribe = () => () => {};

type Permission = NotificationPermission | "unsupported" | "unknown";

/** Notification permission for this platform (Android: the background runner's). */
function usePermission() {
  const native = useSyncExternalStore(noSubscribe, isNativeApp, () => false);
  const [perm, setPerm] = useState<Permission>("unknown");
  useEffect(() => {
    let live = true;
    const read = async () => {
      const p = native ? await nativePermission(false).catch(() => runnerPermission(false).catch(() => "prompt")) : webPermission();
      if (live) setPerm(p === "granted" ? "granted" : p === "denied" ? "denied" : p === "unsupported" ? "unsupported" : "default");
    };
    void read();
    return () => {
      live = false;
    };
  }, [native]);
  const request = async (): Promise<Permission> => {
    // Android: Local Notifications' prompt (POST_NOTIFICATIONS); the background runner shares the permission.
    const p = native ? await nativePermission(true).catch(() => runnerPermission(true).catch(() => "denied")) : await requestWebPermission();
    const next: Permission = p === "granted" ? "granted" : p === "denied" ? "denied" : p === "unsupported" ? "unsupported" : "default";
    setPerm(next);
    announcePermission();
    return next;
  };
  return { native, perm, request };
}

/** Android 0.4.3+: what the native checker last did, and whether anything is in its way. */
function useNativeStatus() {
  const available = useSyncExternalStore(noSubscribe, nativeAlertsAvailable, () => false);
  const [status, setStatus] = useState<NativeAlertsStatus | null>(null);
  useEffect(() => {
    if (!available) return;
    let live = true;
    const read = () => void nativeAlerts.status().then((s) => live && setStatus(s), () => {});
    read();
    const t = setInterval(read, 15_000);
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", read);
    };
  }, [available]);
  return { available, status };
}

function NativeStatus({ status }: { status: NativeAlertsStatus }) {
  const now = useNow(15_000);
  return (
    <div className="mt-3 space-y-2 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
      <p>
        <span className="font-medium text-ink">Background checks:</span>{" "}
        {status.lastRun ? `last ran ${timeAgo(status.lastRun, now)}${status.lastResult ? ` (${status.lastResult})` : ""}.` : "waiting for the first run (needs a network connection)."}
      </p>
      {!status.allowed && <p className="text-nogo">Android is blocking Storm Central&apos;s notifications. Turn them on in notification settings.</p>}
      {!status.batteryUnrestricted && (
        <p>
          Battery optimization can delay checks by an hour or more on some phones. Allow Storm Central to run in the background so warnings arrive on time.
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {!status.batteryUnrestricted && (
          <Button size="sm" onClick={() => void nativeAlerts.requestBatteryExemption().catch(() => {})}>
            <BatteryCharging className="size-4" aria-hidden />
            Allow background activity
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void nativeAlerts.openNotificationSettings().catch(() => {})}>
          <Settings2 className="size-4" aria-hidden />
          Notification settings
        </Button>
      </div>
    </div>
  );
}

function NotificationsPanel() {
  const settings = useAlertsStore((s) => s.settings);
  const setSettings = useAlertsStore((s) => s.setSettings);
  const { native, perm, request } = usePermission();
  const nativeChecks = useNativeStatus();
  const [tested, setTested] = useState<"no" | "sent" | "failed">("no");

  // The switch always follows the tap; if permission is refused, the status line says so.
  const setEnabled = (on: boolean) => {
    setSettings({ enabled: on });
    if (on && perm !== "granted") void request();
  };
  const test = async () => {
    if (perm !== "granted" && (await request()) !== "granted") return;
    const n = { id: 1, title: "Storm Central", body: "Notifications are working. Warnings for your places will look like this.", kind: "test" as const };
    try {
      // Android 0.4.3+: through the same native path real alerts use.
      if (nativeChecks.available) setTested((await nativeAlerts.test()).shown ? "sent" : "failed");
      else {
        if (native) await showNativeNotification(n);
        else showWebNotification(n);
        setTested("sent");
      }
    } catch {
      setTested("failed");
    }
  };

  const status =
    perm === "denied"
      ? "Notifications are blocked. Allow them for Storm Central in your browser or system settings."
      : perm === "unsupported"
        ? "This browser can't show notifications."
        : settings.enabled && perm !== "granted"
          ? "Allow notifications when your device asks, or tap Send a test notification."
        : native
          ? "Checked about every 15 minutes, even when the app is closed."
          : "Checked every 2 minutes while Storm Central is open (the Windows app keeps checking from the tray).";

  return (
    <Panel title="Notifications" subtitle="NWS warnings for your places, and your custom alerts">
      <div className="divide-y divide-line">
        <Toggle label="Notify me" checked={settings.enabled} onChange={setEnabled} />
        <Toggle label="Watch my selected location" checked={settings.watchCurrent} onChange={(watchCurrent) => setSettings({ watchCurrent })} />
      </div>
      <div className="mt-3">
        <p className="label mb-1.5">Which alerts: warnings only, or warnings plus watches and advisories</p>
        <Segmented
          ariaLabel="Which alerts"
          stretch
          value={settings.level}
          onChange={(level) => setSettings({ level })}
          options={[
            { value: "warnings", label: "Warnings" },
            { value: "all", label: "+ Watches" },
          ]}
        />
      </div>
      <div className="mt-4">
        <p className="label mb-1">Notify me about</p>
        <div className="divide-y divide-line">
          {ALERT_CATEGORIES.map((c) => (
            <Toggle
              key={c.id}
              label={c.label}
              checked={settings.categories?.[c.id] !== false}
              onChange={(on) => setSettings({ categories: { ...settings.categories, [c.id]: on } })}
            />
          ))}
          <Toggle label="My custom alerts" checked={settings.custom !== false} onChange={(custom) => setSettings({ custom })} />
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-3">{status}</p>
      <Button size="sm" className="mt-3" onClick={() => void test()} disabled={perm === "unsupported" || perm === "denied"}>
        <Bell className="size-4" aria-hidden />
        {tested === "sent" ? "Sent" : "Send a test notification"}
      </Button>
      {tested === "failed" && <p className="mt-2 text-xs text-nogo">Couldn&apos;t show a notification. Check that Storm Central&apos;s notifications are allowed in your phone&apos;s settings.</p>}
      {nativeChecks.available && nativeChecks.status && settings.enabled && <NativeStatus status={nativeChecks.status} />}
    </Panel>
  );
}

/** Distance choices in the person's units, stored in km. */
function distanceOptions(imperial: boolean, km: readonly number[]) {
  return km.map((k) => ({ value: String(k), label: imperial ? `${Math.round(k / 1.609)} mi` : `${k} km` }));
}

const SELECT =
  "h-9 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-40 pointer-coarse:h-11";

function OptionRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm text-ink">{label}</p>
        <p className="text-xs text-ink-3">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** Morning briefing, lightning nearby and nearby spotter reports. */
function MoreAlertsPanel() {
  const settings = useAlertsStore((s) => s.settings);
  const setSettings = useAlertsStore((s) => s.setSettings);
  const imperial = useAppStore((s) => s.units.distance) === "mi";
  const briefing = settings.briefing ?? DEFAULT_BRIEFING;
  const lightning = settings.lightning ?? DEFAULT_LIGHTNING;
  const spotter = settings.spotter ?? DEFAULT_SPOTTER;
  const rain = settings.rain ?? DEFAULT_RAIN;
  const storms = settings.storms ?? { enabled: false };
  const activity = settings.activity ?? { enabled: false };
  const { data: session } = useSession();
  const off = !settings.enabled;
  return (
    <Panel title="More notifications" subtitle={off ? "Turn on Notify me above to use these" : "For your watched places"}>
      <div className="divide-y divide-line">
        <OptionRow label="Rain starting soon" hint="When rain or snow is about to start where you are, once per spell (15-minute forecast)">
          <select
            aria-label="How far ahead"
            value={String(rain.leadMin)}
            disabled={off || !rain.enabled}
            onChange={(e) => setSettings({ rain: { ...rain, leadMin: Number(e.target.value) } })}
            className={SELECT}
          >
            {RAIN_LEAD_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 60 ? "Up to 1 hour ahead" : `Up to ${m} min ahead`}
              </option>
            ))}
          </select>
          <Toggle hideLabel label="Rain starting soon" checked={rain.enabled} onChange={(enabled) => setSettings({ rain: { ...rain, enabled } })} />
        </OptionRow>
        <OptionRow label="Storms heading your way" hint="A strong storm on radar (hail, rotation or heavy core) due to reach a watched place within the hour, with its arrival time">
          <Toggle hideLabel label="Storms heading your way" checked={storms.enabled} onChange={(enabled) => setSettings({ storms: { enabled } })} />
        </OptionRow>
        <OptionRow label="Morning briefing" hint="Today's high and low, rain chance and anything notable, once a day">
          <input
            type="time"
            aria-label="Briefing time"
            value={briefing.time}
            disabled={off || !briefing.enabled}
            onChange={(e) => e.target.value && setSettings({ briefing: { ...briefing, time: e.target.value } })}
            className={SELECT}
          />
          <Toggle hideLabel label="Morning briefing" checked={briefing.enabled} onChange={(enabled) => setSettings({ briefing: { ...briefing, enabled } })} />
        </OptionRow>
        <OptionRow label="Lightning nearby" hint="Strikes in the last 15 minutes (NOAA), at most every 45 minutes per place">
          <select
            aria-label="Lightning distance"
            value={String(lightning.radiusKm)}
            disabled={off || !lightning.enabled}
            onChange={(e) => setSettings({ lightning: { ...lightning, radiusKm: Number(e.target.value) } })}
            className={SELECT}
          >
            {distanceOptions(imperial, [8, 16, 32, 48]).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Toggle hideLabel label="Lightning nearby" checked={lightning.enabled} onChange={(enabled) => setSettings({ lightning: { ...lightning, enabled } })} />
        </OptionRow>
        {COMMUNITY_ENABLED && (
          <OptionRow label="Nearby spotter reports" hint="Tornado, hail, wind damage, flooding or other serious reports from the last hour">
            <select
              aria-label="Spotter report distance"
              value={String(spotter.radiusKm)}
              disabled={off || !spotter.enabled}
              onChange={(e) => setSettings({ spotter: { ...spotter, radiusKm: Number(e.target.value) } })}
              className={SELECT}
            >
              {distanceOptions(imperial, [16, 40, 80, 160]).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Toggle hideLabel label="Nearby spotter reports" checked={spotter.enabled} onChange={(enabled) => setSettings({ spotter: { ...spotter, enabled } })} />
          </OptionRow>
        )}
        {COMMUNITY_ENABLED && (
          <OptionRow label="Activity on your reports" hint={session ? "When someone confirms or comments on a report you posted" : "Sign in to the spotter network to use this"}>
            <Toggle hideLabel label="Activity on your reports" checked={activity.enabled} onChange={(enabled) => setSettings({ activity: { enabled } })} />
          </OptionRow>
        )}
      </div>
    </Panel>
  );
}

function PlacesPanel() {
  const places = useAlertsStore((s) => s.places);
  const addPlace = useAlertsStore((s) => s.addPlace);
  const removePlace = useAlertsStore((s) => s.removePlace);
  const location = useAppStore((s) => s.location);
  const setLocation = useAppStore((s) => s.setLocation);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({ queryKey: ["place-search", term], queryFn: ({ signal }) => searchPlaces(term, signal), enabled: term.length >= 2, staleTime: 60_000 });
  const full = places.length >= MAX_PLACES;
  const savedHere = places.some((p) => Math.abs(p.lat - location.lat) < 0.01 && Math.abs(p.lon - location.lon) < 0.01);

  return (
    <Panel
      title="Saved places"
      subtitle={`Warnings are checked for each place (up to ${MAX_PLACES})`}
      action={
        <Button size="sm" variant="ghost" onClick={() => addPlace({ name: location.name, lat: location.lat, lon: location.lon })} disabled={full || savedHere}>
          <Plus className="size-4" aria-hidden />
          {savedHere ? "Saved" : "Save current"}
        </Button>
      }
    >
      {places.length === 0 ? (
        <EmptyState title="No saved places">Save home, work or the cabin to get warnings for them wherever you are.</EmptyState>
      ) : (
        <ul className="-mx-1 divide-y divide-line">
          {places.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-1 py-1.5">
              <MapPin className="size-4 shrink-0 text-ink-3" aria-hidden />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
                onClick={() => setLocation({ lat: p.lat, lon: p.lon, name: p.name, source: "search" })}
                title="Show this place"
              >
                {p.name}
              </button>
              <IconButton label={`Remove ${p.name}`} size="sm" onClick={() => removePlace(p.id)}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="mt-3">
          <label htmlFor="place-search" className="label mb-1.5 block">
            Add a place
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input id="place-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a city or town" className={`${INPUT} pl-9`} autoComplete="off" />
          </div>
          {term.length >= 2 && (
            <ul className="mt-1 divide-y divide-line rounded-[var(--radius-control)] border border-line">
              {results.isLoading && (
                <li className="p-2">
                  <Skeleton className="h-5 w-40" />
                </li>
              )}
              {results.data?.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">No places match “{term}”.</li>}
              {results.data?.map((r) => {
                const name = [r.name, r.countryCode === "US" ? r.region : r.country].filter(Boolean).join(", ");
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-surface-2 pointer-coarse:min-h-11"
                      onClick={() => {
                        addPlace({ name, lat: r.lat, lon: r.lon });
                        setQ("");
                      }}
                    >
                      <Plus className="size-4 shrink-0 text-ink-3" aria-hidden />
                      <span className="truncate">{name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function RulesPanel() {
  const rules = useAlertsStore((s) => s.rules);
  const places = useAlertsStore((s) => s.places);
  const addRule = useAlertsStore((s) => s.addRule);
  const updateRule = useAlertsStore((s) => s.updateRule);
  const removeRule = useAlertsStore((s) => s.removeRule);
  const units = useAppStore((s) => s.units);
  const location = useAppStore((s) => s.location);

  const [metric, setMetric] = useState<RuleMetric>("bite");
  const def = metricDef(metric);
  const [op, setOp] = useState<RuleOp>(def.defaultOp);
  const [value, setValue] = useState(() => String(Math.round(toDisplay(def.kind, def.defaultValue, units))));
  const [placeId, setPlaceId] = useState<string>(CURRENT_PLACE_ID);
  const [hours, setHours] = useState<number>(24);

  const pickMetric = (m: RuleMetric) => {
    const d = metricDef(m);
    setMetric(m);
    setOp(d.defaultOp);
    setValue(String(Math.round(toDisplay(d.kind, d.defaultValue, units))));
  };
  const placeName = (id: string) => (id === CURRENT_PLACE_ID ? `Selected location (${location.name})` : (places.find((p) => p.id === id)?.name ?? "Removed place"));
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n);
  const unit = unitLabel(def.kind, units);

  return (
    <Panel title="Custom alerts" subtitle="Get notified when a forecast crosses your threshold, once a day per alert">
      {rules.length === 0 ? (
        <p className="text-sm text-ink-3">For example: wind at flight altitude below 15 mph, or bite index above 70.</p>
      ) : (
        <ul className="-mx-1 divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-1 py-2">
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${r.enabled ? "text-ink" : "text-ink-3"}`}>{describeRule(r.metric, r.op, r.value, units)}</p>
                <p className="truncate text-xs text-ink-3">
                  {placeName(r.placeId)}, next {r.hours} h
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-3">
                <input type="checkbox" checked={r.enabled} onChange={(e) => updateRule(r.id, { enabled: e.target.checked })} className="size-4 accent-[var(--color-accent)]" />
                On
              </label>
              <IconButton label="Delete alert" size="sm" onClick={() => removeRule(r.id)}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {rules.length < MAX_RULES && (
        <form
          className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            addRule({ metric, op, value: fromDisplay(def.kind, n, units), placeId, hours, enabled: true });
          }}
        >
          <label className="col-span-2 sm:col-span-1">
            <span className="label mb-1.5 block">When</span>
            <select value={metric} onChange={(e) => pickMetric(e.target.value as RuleMetric)} className={INPUT}>
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {METRICS.filter((m) => m.group === g).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span className="label mb-1.5 block">Is</span>
            <select value={op} onChange={(e) => setOp(e.target.value as RuleOp)} className={INPUT}>
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </label>
          <label>
            <span className="label mb-1.5 block">Value{unit ? ` (${unit})` : ""}</span>
            <input type="number" inputMode="decimal" step="any" value={value} onChange={(e) => setValue(e.target.value)} className={INPUT} aria-invalid={!valid} />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className="label mb-1.5 block">At</span>
            <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} className={INPUT}>
              <option value={CURRENT_PLACE_ID}>Selected location</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label mb-1.5 block">Within</span>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={INPUT}>
              {WINDOWS.map((h) => (
                <option key={h} value={h}>
                  {h} hours
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full" disabled={!valid}>
              <Plus className="size-4" aria-hidden />
              Add alert
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/** /alerts: notification settings, saved places and custom alerts. All stored on this device. */
export function AlertsSettings() {
  const hydrated = useAlertsStore((s) => s.hydrated);
  if (!hydrated) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-4">
      <NotificationsPanel />
      <MoreAlertsPanel />
      <PlacesPanel />
      <RulesPanel />
      <p className="text-xs text-ink-3">Places and alerts are stored on this device only. Notifications can be late or missed; always follow official warnings.</p>
    </div>
  );
}
