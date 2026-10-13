"use client";

/**
 * Native Android notifications (android/.../StormAlertsPlugin.java and
 * AlertsWorker.java): warnings, lightning, nearby reports and the morning
 * briefing are checked by WorkManager every 15 minutes and posted by Android
 * itself, so they arrive with the app closed. Apps installed before 0.4.3
 * don't have the plugin; callers check {@link nativeAlertsAvailable} and fall
 * back to the background runner.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeAlertsStatus {
  allowed: boolean;
  batteryUnrestricted: boolean;
  lastRun: number | null;
  lastResult: string | null;
}

interface StormAlertsPlugin {
  sync(): Promise<void>;
  checkNow(): Promise<void>;
  test(): Promise<{ shown: boolean }>;
  status(): Promise<NativeAlertsStatus>;
  openNotificationSettings(): Promise<void>;
  requestBatteryExemption(): Promise<void>;
}

const StormAlerts = registerPlugin<StormAlertsPlugin>("StormAlerts");

/** True in Android builds that carry the native notifications plugin. */
export const nativeAlertsAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("StormAlerts");

export const nativeAlerts = StormAlerts;
